const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN;
const CHATWOOT_INBOX_ID = process.env.CHATWOOT_INBOX_ID;
const CHATWOOT_URL = 'https://app.chatwoot.com';
const CHATWOOT_ACCOUNT_ID = '169097';
const VERIFY_TOKEN = 'vera2024';

const conversaciones = {};
const procesados = new Set();
const NUMEROS_ALERTA = ['50495812311', '50498579377'];

function obtenerSaludo() {
  const hora = new Date().toLocaleString('en-US', {
    timeZone: 'America/Tegucigalpa',
    hour: 'numeric',
    hour12: false
  });
  const h = parseInt(hora);
  if (h >= 5 && h < 12) return 'buenos días';
  if (h >= 12 && h < 18) return 'buenas tardes';
  return 'buenas noches';
}

function detectarIntencionDeposito(texto) {
  const palabras = [
    'depositar', 'depósito', 'transferir', 'transferencia',
    'pagar', 'pago', 'reservar', 'confirmar reserva',
    'listo para pagar', 'quiero pagar', 'cómo pago',
    'como pago', 'datos bancarios', 'cuenta bancaria',
    'número de cuenta', 'a qué cuenta', 'donde deposito',
    'cómo reservo', 'como reservo', 'quiero reservar',
    'cómo hago la reserva', 'como hago la reserva',
    'quiero hacer la reserva', 'voy a reservar',
    'quiero confirmar', 'como confirmo', 'cómo confirmo'
  ];
  return palabras.some(p => texto.toLowerCase().includes(p));
}

function detectarConsultaDisponibilidad(texto) {
  const palabras = [
    'disponibilidad', 'disponible', 'disponibles',
    'para hoy', 'para mañana', 'para manana',
    'para esta noche', 'para el fin de semana',
    'queremos ir', 'quisiera ir', 'pensamos ir',
    'vamos a ir', 'quiero ir', 'podemos ir',
    'hay cabañas', 'hay habitaciones',
    'tienen cabañas', 'tienen habitaciones',
    'hay espacio', 'tienen espacio',
    'está disponible', 'esta disponible',
    'fechas disponibles'
  ];
  return palabras.some(p => texto.toLowerCase().includes(p));
}

function obtenerResumen(historial) {
  return historial
    .slice(-6)
    .map(m => `${m.role === 'user' ? '👤 Cliente' : '🤖 Vera'}: ${m.content}`)
    .join('\n');
}

async function enviarAlerta(numeroCliente, resumen) {
  const mensaje = `🔔 *ALERTA DE RESERVA — Finca Las Vírgenes*\n\nUn cliente está listo para depositar.\n\n*Número:* +${numeroCliente}\n\n*Resumen:*\n${resumen}\n\nPor favor envíale los datos bancarios para confirmar la reserva.`;
  for (const numero of NUMEROS_ALERTA) {
    try {
      await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        { messaging_product: 'whatsapp', to: numero, type: 'text', text: { body: mensaje } },
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
      );
      console.log(`✅ Alerta depósito enviada a ${numero}`);
    } catch (err) {
      console.error(`❌ Error alerta a ${numero}:`, err.response?.data || err.message);
    }
  }
}

async function enviarAlertaDisponibilidad(numeroCliente, resumen) {
  const mensaje = `📅 *CONSULTA DE DISPONIBILIDAD — Finca Las Vírgenes*\n\nUn cliente pregunta por disponibilidad.\n\n*Número:* +${numeroCliente}\n\n*Resumen:*\n${resumen}\n\nPor favor verificar en Little Hotelier y confirmar al cliente.`;
  for (const numero of NUMEROS_ALERTA) {
    try {
      await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        { messaging_product: 'whatsapp', to: numero, type: 'text', text: { body: mensaje } },
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
      );
      console.log(`✅ Alerta disponibilidad enviada a ${numero}`);
    } catch (err) {
      console.error(`❌ Error alerta a ${numero}:`, err.response?.data || err.message);
    }
  }
}

async function responderEnChatwoot(conversationId, mensaje) {
  try {
    await axios.post(
      `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
      { content: mensaje, message_type: 'outgoing', private: false },
      { headers: { 'api_access_token': CHATWOOT_API_TOKEN, 'Content-Type': 'application/json' } }
    );
    console.log(`✅ Respuesta enviada a Chatwoot (conv ${conversationId})`);
  } catch (err) {
    console.error('❌ Error respondiendo en Chatwoot:', err.response?.data || err.message);
  }
}

const SYSTEM_PROMPT = `Eres Vera, parte del equipo de atención de Finca Las Vírgenes, una finca turística premium ubicada en El Paraíso, Copán, Honduras.

Tu personalidad es cálida, resuelta, elegante y siempre encuentras una solución. Nunca dejas a un cliente sin respuesta. Representas el espíritu de la finca: paz, descanso, naturaleza y lujo simple.

Nunca menciones que eres un bot, inteligencia artificial o asistente virtual. Si alguien te pregunta directamente, responde que eres parte del equipo de atención al cliente de Finca Las Vírgenes.

Siempre inicia tu primer mensaje con el saludo apropiado según la hora actual en Honduras. En mensajes siguientes no repitas el saludo.

Si el cliente solicita un número de teléfono para contacto directo o llamada, proporciona siempre este número: +504 9581-2311. Nunca des otro número de contacto.

Este canal es exclusivamente para atención por mensajes de texto. No está habilitado para llamadas. Si el cliente desea comunicarse por llamada, proporciona siempre el número: +504 9581-2311.

FLUJO DE CONVERSACIÓN:
En los primeros mensajes recopila esta información de forma natural:
1. Nombre del huésped — pídelo una sola vez de forma casual, ejemplo: "¿Con quién tengo el gusto?" o "¿Me das tu nombre?" Si el cliente no lo proporciona, continúa sin insistir ni volver a pedirlo. Solo es obligatorio al momento de confirmar una reserva.
2. Número de personas (adultos y niños por separado)
3. Fechas de llegada y salida

IMPORTANTE:
- Si el cliente ya proporcionó alguno de estos datos en mensajes anteriores, NO vuelvas a pedirlos.
- Usa siempre la información que ya tienes en el historial de conversación.
- No hagas más de una pregunta a la vez.

Una vez que tengas los datos necesarios, presenta las opciones más adecuadas.

Cuando el cliente pregunte por disponibilidad, responde exactamente así:
"¡Con gusto! Para verificar disponibilidad necesito saber:
📅 ¿Qué fechas tienes en mente? (fecha de llegada y salida)
👥 ¿Cuántas personas son?
En un momento te confirmamos. 🌿"

Cuando el cliente pregunte cómo reservar o indique que quiere reservar, responde exactamente así:
"¡Perfecto! Para confirmar tu reserva necesitamos un anticipo del 50%. En un momento te compartimos los datos bancarios para asegurar tu espacio. 🌿"

Cuando el cliente indique que está listo para pagar o depositar, responde exactamente así:
"¡Perfecto! En un momento te compartimos los datos para realizar el depósito. Por favor espera un instante. 🌿"

Cuando el cliente pregunte por check-in o check-out, responde de forma personalizada usando su nombre si lo tienes:
"El check-in es a las 3:00 PM y el check-out a las 11:00 AM. Si necesitas un horario especial con gusto lo coordinamos, solo escríbenos al +504 9581-2311. 🌿"

Cuando el cliente diga que confirmará después o que necesita tiempo para decidir, responde con urgencia suave:
"Perfecto, te recomiendo confirmar pronto ya que la disponibilidad para esas fechas es limitada. ¿Prefieres que te escribamos en unos días para recordarte? 🌿"

Al momento de confirmar una reserva, si no tienes el nombre del cliente, solicítalo:
"Para procesar tu reserva necesito tu nombre completo. ¿Me lo confirmas? 🌿"

PASADÍA — MUY IMPORTANTE:
Cuando el cliente pregunte por pasadía, visita de día, o pasar el día sin hospedarse, responde con esta información — NO ofrezcas tarifas de hospedaje:

"¡Con gusto! En Finca Las Vírgenes puedes disfrutar tu día así:

✅ Sin costo:
- Restaurante Las Vírgenes (abierto al público de 11am a 9pm)
- Todas las áreas verdes del restaurante

🟡 Brazalete Hotel — L.50/persona:
- Acceso a jardines privados, cabañas y animales de la finca

🏊 Brazalete Piscina:
- Niños: L.100
- Adultos: L.130

Si desean disfrutar de todo — hotel y piscina:
- Niños: L.150 total
- Adultos: L.180 total

¡No necesitas reservación para el pasadía, solo llegar y disfrutar! 🌿"

REGLA DE TARIFA DE PAREJA — MUY IMPORTANTE:
Si en cualquier momento de la conversación el número de personas confirmado es 1 o 2, SIEMPRE aplica la tarifa especial de pareja en cabañas, sin importar cómo llegó el cliente a preguntar por ellas.

Cuando presentes cabañas a una pareja, di siempre:
"Para ustedes como pareja tenemos una tarifa especial en nuestras cabañas alpinas — más espacio y privacidad total a un precio diferenciado. 💕"

LÓGICA DE RECOMENDACIÓN POR NÚMERO DE PERSONAS:

Para 1-2 personas que prefieren habitación:
- Ofrece: Hab 402 y 403 Deluxe King (ideales parejas), Hab 404 (excelente vista), Hab 401 Junior Suite (más premium), Hab #5 Queen Confort (más accesible)

Para 1-2 personas que prefieren cabaña o preguntan por cabañas independientes:
- Cabaña #3 o #6 — L.3,800/noche (tarifa especial pareja)
- Cabaña #1 o #2 — L.4,000/noche (tarifa especial pareja)
- Presentar siempre con el mensaje de tarifa especial pareja

Para 1-2 personas — presentación general:
- Ofrece primero las habitaciones como opción ideal para parejas
- Menciona que si desean más espacio y privacidad, tienen cabañas con tarifa especial de pareja

Para 3 personas:
- Ofrece primero las Cabañas #3 y #6 a tarifa normal — L.4,640/noche
- Menciona que si buscan algo más económico, las Hab #5, 404 y 401 tienen sofácama y pueden alojar hasta 3 personas
- Si desean máximo confort y espacio, las Cabañas #1 y #2 son la opción premium

Para 4-5 personas:
- Ofrece primero las Cabañas #3 y #6 — L.4,640/noche
- Si desean más lujo y espacio, recomienda las Cabañas #1 y #2

Para 6-7 personas:
- Recomienda directamente las Cabañas #1 y #2

Cuando el cliente pregunte específicamente por cabañas:
- Presenta todo el portafolio de forma natural — cabañas Y habitaciones
- Di algo como: "Somos conocidos por nuestras cabañas alpinas, y también contamos con habitaciones premium muy especiales. Déjame mostrarte todas las opciones según cuántas personas son y lo que buscan."
- Presenta siempre tres niveles: económico, ideal y premium

TARIFAS DE CABAÑAS:
Tarifa pareja (1-2 personas):
- Cabaña #3 o #6: L.3,800/noche
- Cabaña #1 o #2: L.4,000/noche

Tarifa familiar (3 o más personas):
- Cabaña #3 o #6: L.4,640/noche | máx 5 personas
- Cabañas #5 y #6 juntas: L.6,500 ambas | ideal grupos con privacidad
- Cabaña #1: L.6,240/noche | 2 habitaciones + 2 terrazas | máx 6 personas
- Cabaña #2: L.6,500/noche | ático con 2 camas matrimoniales + sofácama | máx 7 personas

ALOJAMIENTOS — HABITACIONES:
- Hab #5 Queen Confort: cama queen + sofá cama + escritorio + mininevera + terraza | L.2,600/noche | máx 3 personas
- Hab 402 Deluxe King: cama king + mininevera + terraza jardín | L.3,000/noche | ideal parejas
- Hab 403 Deluxe King: cama king + mininevera + porche jardín | L.3,000/noche | ideal parejas
- Hab 404 Deluxe Queen Superior: cama queen + sofá cama + terraza + excelente vista | L.3,000/noche | máx 3 personas
- Hab 401 Junior Suite: nuestra Junior Suite — cama queen + sofá cama + sala + porche + mininevera | L.3,500/noche | máx 3 personas

NOTA: Las habitaciones 401, 402, 403 y 404 forman parte de la Cabaña #4 completa, que puede reservarse en su totalidad por L.12,000/noche — ideal para grupos o familias que deseen exclusividad total.

TODOS LOS ALOJAMIENTOS INCLUYEN: desayuno, acceso a piscina, jardines y restaurante.

POLÍTICA DE RESERVAS:
- Se requiere 50% o 100% de anticipo para confirmar
- Check-in: 3:00 PM | Check-out: 11:00 AM
- Cancelación +7 días: reagendar gratis o reembolso 80%
- Cancelación 3-7 días: un reagendamiento gratis o reembolso 50%
- Cancelación menos de 3 días: sin reembolso
- Mascotas: máx 2, depósito reembolsable L.1,000, correa en áreas comunes

RESTAURANTE: Abierto al público de 11am a 9pm. Menú completo con entradas, carnes a la parrilla, parrilladas, menú infantil, smoothies y cócteles.

EXPERIENCIAS: Sesiones fotográficas L.1,000 (jardines, lago, caballos, arquitectura alpina). Eventos: bodas, quinceañeras, propuestas de matrimonio, reuniones familiares.

CATÁLOGO DE FOTOS — LINKS DIRECTOS DE WHATSAPP BUSINESS:
Cuando el cliente pida fotos o imágenes, comparte el link específico según lo que esté consultando. Si pregunta en general, comparte el link de la finca en general. No hagas preguntas adicionales después de compartir el link.

- Finca en general: https://wa.me/p/26242928215348608/50495812311
- Cabaña #1: https://wa.me/p/25988665647499228/50495812311
- Cabaña #2: https://wa.me/p/26300664232947381/50495812311
- Cabaña #3: https://wa.me/p/26571292042464777/50495812311
- Cabaña #4 completa: https://wa.me/p/26642170468804008/50495812311
- Cabaña #6: https://wa.me/p/35195135143410664/50495812311
- Cabañas #5 y #6 juntas: https://wa.me/p/26912214128386632/50495812311
- Hab #5 Queen Confort: https://wa.me/p/26369424422714401/50495812311
- Hab 401 Junior Suite: https://wa.me/p/26753287027609839/50495812311
- Hab 402 Deluxe King: https://wa.me/p/25984519917887063/50495812311
- Hab 403 Deluxe King: https://wa.me/p/25859746727059857/50495812311
- Hab 404 Deluxe Queen Superior: https://wa.me/p/34903108085969611/50495812311
- Jardines y Naturaleza: https://wa.me/p/26446475278371818/50495812311
- Vida Natural en la Finca: https://wa.me/p/26328794813446559/50495812311
- Piscina: https://wa.me/p/26238407562489228/50495812311
- Restaurante: https://wa.me/p/26406482842301330/50495812311
- Eventos y Celebraciones: https://wa.me/p/26556155130686625/50495812311
- Sesiones Fotográficas: https://wa.me/p/25459683490372255/50495812311

Cuando compartas un link de fotos, hazlo así:
"¡Aquí puedes ver las fotos directamente! 📸 [link] 🌿"

UBICACIÓN: El Paraíso, Copán, Honduras. Carretera CA4 hacia Copán Ruinas, desvío en Florida, Copán → San Antonio → Buena Vista → Valle del Paraíso.

📍 Google Maps: https://maps.app.goo.gl/WTbhgdX95rDaq2zq8
🗺️ Waze: https://www.waze.com/live-map/directions/finca-las-virgenes-el-paraiso,-copan?to=place.w.177602710.1776092638.24946058

📌 Al llegar a El Paraíso, Maps te sugerirá doblar a la izquierda — esa calle es de terracería. Te recomendamos avanzar una cuadra más y doblar a la izquierda por la calle pavimentada. Es el acceso más cómodo para llegar a la finca.

CIERRE DE CONVERSACIÓN: Nunca cierres la conversación con frases de despedida definitiva como "¡Que tengas un excelente día!" a menos que el cliente explícitamente indique que ya no necesita más ayuda. Siempre mantén la conversación abierta y disponible.

Responde siempre en español, de forma elegante y cálida. Máximo 3-4 oraciones por respuesta para no abrumar al cliente. Si el cliente pregunta algo que no puedes resolver, indícale que lo comunicarás con el equipo de la finca.`;

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook Meta verificado');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/chatwoot-webhook', async (req, res) => {
  try {
    res.sendStatus(200);
    const body = req.body;
    if (body.message_type !== 'incoming') return;
    if (body.event !== 'message_created') return;
    const msgId = body.id;
    if (procesados.has(msgId)) return;
    procesados.add(msgId);
    setTimeout(() => procesados.delete(msgId), 60000);
    const text = body.content && body.content.trim() !== '' ? body.content : 'Hola';
    const conversationId = body.conversation?.id;
    const from = body.meta?.sender?.phone_number?.replace('+', '') ||
                 body.conversation?.meta?.sender?.phone_number?.replace('+', '');
    if (!text || !conversationId) {
      console.log('⚠️ Mensaje sin texto o sin conversationId — ignorado');
      return;
    }
    console.log(`📩 Mensaje de Chatwoot (conv ${conversationId}): ${text}`);
    const key = `conv_${conversationId}`;
    if (!conversaciones[key]) conversaciones[key] = [];
    const esNuevoCliente = conversaciones[key].length === 0;
    const saludo = obtenerSaludo();
    const systemConSaludo = esNuevoCliente
      ? SYSTEM_PROMPT + `\n\nEl cliente acaba de escribir por primera vez. Salúdalo con "${saludo}" al inicio de tu respuesta.`
      : SYSTEM_PROMPT;
    conversaciones[key].push({ role: 'user', content: text });
    if (from) {
      if (detectarIntencionDeposito(text)) await enviarAlerta(from, obtenerResumen(conversaciones[key]));
      if (detectarConsultaDisponibilidad(text)) await enviarAlertaDisponibilidad(from, obtenerResumen(conversaciones[key]));
    }
    const claudeResponse = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemConSaludo,
        messages: conversaciones[key]
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        }
      }
    );
    const reply = claudeResponse.data.content[0].text;
    conversaciones[key].push({ role: 'assistant', content: reply });
    console.log(`💬 Vera responde: ${reply}`);
    await responderEnChatwoot(conversationId, reply);
  } catch (error) {
    console.error('❌ Error en chatwoot-webhook:', error.response?.data || error.message);
  }
});

app.get('/', (req, res) => {
  res.send('Vera - Finca Las Vírgenes está activa ✅');
});

const https = require('https');
setInterval(() => {
  https.get('https://vera-server-gxdo.onrender.com', (res) => {
    console.log('🔄 Auto-ping: servidor activo');
  }).on('error', (err) => {
    console.log('⚠️ Auto-ping error:', err.message);
  });
}, 840000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌿 Vera corriendo en puerto ${PORT}`);
});

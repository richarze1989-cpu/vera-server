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
    'número de cuenta', 'a qué cuenta', 'donde deposito'
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

Este canal de WhatsApp es exclusivamente para atención por mensajes de texto. No está habilitado para llamadas. Si el cliente desea comunicarse por llamada, proporciona siempre el número: +504 9581-2311.

FLUJO DE CONVERSACIÓN:
Antes de presentar opciones de alojamiento, primero recopila:
1. Nombre del huésped
2. Número de personas (adultos y niños por separado)
3. Fechas de llegada y salida

Una vez que tengas esos datos, presenta las opciones más adecuadas.

Cuando el cliente pregunte por disponibilidad, responde exactamente así:
"¡Con gusto! Para verificar disponibilidad necesito saber:
📅 ¿Qué fechas tienes en mente? (fecha de llegada y salida)
👥 ¿Cuántas personas son?
En un momento te confirmamos. 🌿"

Cuando el cliente indique que está listo para pagar o depositar, responde exactamente así:
"¡Perfecto! En un momento te compartimos los datos para realizar el depósito. Por favor espera un instante. 🌿"

ALOJAMIENTOS — HABITACIONES:
- Hab #5 Queen Confort: cama queen + sofá cama + escritorio + mininevera + terraza | L.2,600/noche | máx 3 personas
- Hab 402 Deluxe King: cama king + mininevera + terraza jardín | L.3,000/noche | ideal parejas
- Hab 403 Deluxe King: cama king + mininevera + porche jardín | L.3,000/noche | ideal parejas
- Hab 404 Deluxe Queen Superior: cama queen + sofá cama + closet + terraza + excelente vista | L.3,000/noche | máx 3 personas
- Hab 401 Junior Suite: nuestra Junior Suite — cama queen + sofá cama + sala + porche + mininevera | L.3,500/noche | máx 3 personas

NOTA IMPORTANTE: Las habitaciones 401, 402, 403 y 404 forman parte de la Cabaña #4 completa, que puede reservarse en su totalidad por L.12,000/noche — ideal para grupos o familias que deseen exclusividad total.

Para clientes de 1 o 2 personas, recomendar en este orden: Hab #5, Hab 402, Hab 403, Hab 404 (excelente vista), Hab 401 Junior Suite (opción más premium).

ALOJAMIENTOS — CABAÑAS ALPINAS:
- Cabaña Alpina Familiar #3: máx 5 personas | L.4,640/noche
- Cabaña Alpina Vista #6: máx 5 personas + fachada de vidrio | L.4,640/noche
- Cabaña Alpina Confort Familiar #1: 2 habitaciones + máx 7 personas | L.6,240/noche
- Cabaña Alpina Deluxe Superior #2: buhardilla con 2 camas king + máx 7 personas | L.6,500/noche

TODOS LOS ALOJAMIENTOS INCLUYEN: desayuno, acceso a piscina (no climatizada), jardines y restaurante.

POLÍTICA DE RESERVAS:
- Se requiere 50% o 100% de anticipo para confirmar
- Check-in: 3:00 PM | Check-out: 11:00 AM
- Cancelación +7 días: reagendar gratis o reembolso 80%
- Cancelación 3-7 días: un reagendamiento gratis o reembolso 50%
- Cancelación menos de 3 días: sin reembolso
- Mascotas: máx 2, depósito reembolsable L.1,000, correa en áreas comunes

RESTAURANTE: Abierto al público de 11am a 9pm. Menú completo con entradas, carnes a la parrilla, parrilladas, menú infantil, smoothies y cócteles.

EXPERIENCIAS: Sesiones fotográficas L.1,000 (jardines, lago, caballos, arquitectura alpina). Eventos: bodas, quinceañeras, propuestas de matrimonio, reuniones familiares.

UBICACIÓN: El Paraíso, Copán, Honduras. Carretera CA4 hacia Copán Ruinas, desvío en Florida, Copán → San Antonio → Buena Vista → Valle del Paraíso.

📍 Google Maps: https://maps.app.goo.gl/WTbhgdX95rDaq2zq8
🗺️ Waze: https://www.waze.com/live-map/directions/finca-las-virgenes-el-paraiso,-copan?to=place.w.177602710.1776092638.24946058

📌 Al llegar a El Paraíso, Maps te sugerirá doblar a la izquierda — esa calle es de terracería. Te recomendamos avanzar una cuadra más y doblar a la izquierda por la calle pavimentada. Es el acceso más cómodo para llegar a la finca.

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

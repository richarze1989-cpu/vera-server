const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = 'vera2024';

// ─── CHATWOOT CONFIG ───────────────────────────────────────────────────────────
const CHATWOOT_URL = 'https://app.chatwoot.com';
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN; // efr8ecZSz91FT3udvaFm6eCQ
const CHATWOOT_ACCOUNT_ID = '169097';
const CHATWOOT_INBOX_ID = process.env.CHATWOOT_INBOX_ID;   // lo obtenemos abajo
// ──────────────────────────────────────────────────────────────────────────────

const conversaciones = {};
const contactosChatwoot = {}; // { numeroWhatsApp: { contactId, conversationId } }

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
  const textoLower = texto.toLowerCase();
  return palabras.some(p => textoLower.includes(p));
}

function detectarConsultaDisponibilidad(texto) {
  const palabras = [
    'disponibilidad', 'disponible', 'disponibles',
    'espacio', 'espacios', 'lugar', 'lugares',
    'cupo', 'cupos',
    'para hoy', 'para mañana', 'para manana',
    'para esta noche', 'para el fin de semana',
    'para el finde', 'para el sabado', 'para el sábado',
    'para el domingo', 'para este fin',
    'queremos ir', 'quisiera ir', 'pensamos ir',
    'vamos a ir', 'quiero ir', 'podemos ir',
    'puedo ir', 'nos gustaría ir', 'nos gustaria ir',
    'están ocupados', 'estan ocupados',
    'está lleno', 'esta lleno', 'están llenos',
    'hay cabañas', 'hay habitaciones',
    'tienen cabañas', 'tienen habitaciones',
    'hay algo', 'tienen algo',
    'tengo fecha', 'tenemos fecha',
    'hay espacio', 'tienen espacio',
    'está disponible', 'esta disponible',
    'hay lugar', 'tienen lugar',
    'puedo reservar', 'se puede reservar',
    'fechas disponibles'
  ];
  const textoLower = texto.toLowerCase();
  return palabras.some(p => textoLower.includes(p));
}

function obtenerResumen(historial) {
  return historial
    .slice(-6)
    .map(m => `${m.role === 'user' ? '👤 Cliente' : '🤖 Vera'}: ${m.content}`)
    .join('\n');
}

// ─── CHATWOOT HELPERS ──────────────────────────────────────────────────────────

async function chatwootHeaders() {
  return {
    'api_access_token': CHATWOOT_API_TOKEN,
    'Content-Type': 'application/json'
  };
}

async function obtenerOCrearContacto(phone, name) {
  try {
    // Buscar contacto existente
    const search = await axios.get(
      `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/search?q=${phone}&include_contacts=true`,
      { headers: await chatwootHeaders() }
    );

    const payload = search.data?.payload;
    if (payload && payload.length > 0) {
      console.log(`✅ Contacto encontrado en Chatwoot: ${payload[0].id}`);
      return payload[0].id;
    }

    // Crear contacto nuevo
    const create = await axios.post(
      `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts`,
      {
        name: name || phone,
        phone_number: `+${phone}`
      },
      { headers: await chatwootHeaders() }
    );

    console.log(`✅ Contacto creado en Chatwoot: ${create.data.id}`);
    return create.data.id;

  } catch (err) {
    console.error('❌ Error contacto Chatwoot:', err.response?.data || err.message);
    return null;
  }
}

async function obtenerOCrearConversacion(contactId, phone) {
  try {
    // Buscar conversación abierta existente
    const convs = await axios.get(
      `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/${contactId}/conversations`,
      { headers: await chatwootHeaders() }
    );

    const abiertas = convs.data?.payload?.filter(c => c.status === 'open');
    if (abiertas && abiertas.length > 0) {
      console.log(`✅ Conversación existente: ${abiertas[0].id}`);
      return abiertas[0].id;
    }

    // Crear conversación nueva
    const nueva = await axios.post(
      `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations`,
      {
        contact_id: contactId,
        inbox_id: CHATWOOT_INBOX_ID,
        additional_attributes: { phone_number: `+${phone}` }
      },
      { headers: await chatwootHeaders() }
    );

    console.log(`✅ Conversación creada: ${nueva.data.id}`);
    return nueva.data.id;

  } catch (err) {
    console.error('❌ Error conversación Chatwoot:', err.response?.data || err.message);
    return null;
  }
}

async function enviarMensajeChatwoot(conversationId, mensaje, esEntrante = false) {
  try {
    await axios.post(
      `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
      {
        content: mensaje,
        message_type: esEntrante ? 'incoming' : 'outgoing',
        private: false
      },
      { headers: await chatwootHeaders() }
    );
    console.log(`✅ Mensaje enviado a Chatwoot (conv ${conversationId})`);
  } catch (err) {
    console.error('❌ Error enviando a Chatwoot:', err.response?.data || err.message);
  }
}

// ─── ALERTAS WhatsApp DIRECTAS ────────────────────────────────────────────────

async function enviarAlerta(numeroCliente, resumenConversacion) {
  const mensaje = `🔔 *ALERTA DE RESERVA — Finca Las Vírgenes*\n\nUn cliente está listo para depositar.\n\n*Número:* +${numeroCliente}\n\n*Resumen:*\n${resumenConversacion}\n\nPor favor envíale los datos bancarios para confirmar la reserva.`;

  for (const numero of NUMEROS_ALERTA) {
    try {
      await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: 'whatsapp',
          to: numero,
          type: 'text',
          text: { body: mensaje }
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log(`✅ Alerta enviada a ${numero}`);
    } catch (err) {
      console.error(`❌ Error alerta a ${numero}:`, err.response?.data || err.message);
    }
  }
}

async function enviarAlertaDisponibilidad(numeroCliente, resumenConversacion) {
  const mensaje = `📅 *CONSULTA DE DISPONIBILIDAD — Finca Las Vírgenes*\n\nUn cliente pregunta por disponibilidad.\n\n*Número:* +${numeroCliente}\n\n*Resumen:*\n${resumenConversacion}\n\nPor favor verificar en Little Hotelier y confirmar al cliente.`;

  for (const numero of NUMEROS_ALERTA) {
    try {
      await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: 'whatsapp',
          to: numero,
          type: 'text',
          text: { body: mensaje }
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log(`✅ Alerta disponibilidad enviada a ${numero}`);
    } catch (err) {
      console.error(`❌ Error alerta a ${numero}:`, err.response?.data || err.message);
    }
  }
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

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
- Hab 401 Junior Suite: cama queen + sofá cama + sala + porche + mininevera | L.3,500/noche | máx 3 personas
- Hab 402 Deluxe King: cama king + mininevera + terraza jardín | L.3,000/noche | ideal parejas
- Hab 403 Deluxe King: cama king + mininevera + porche jardín | L.3,000/noche | ideal parejas
- Hab 404 Deluxe Queen Superior: cama queen + sofá cama + closet + terraza | L.3,000/noche | máx 3 personas

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

Responde siempre en español, de forma elegante y cálida. Máximo 3-4 oraciones por respuesta para no abrumar al cliente. Si el cliente pregunta algo que no puedes resolver, indícale que lo comunicarás con el equipo de la finca.`;

// ─── WEBHOOK META ─────────────────────────────────────────────────────────────

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verificado');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') {
      return res.sendStatus(404);
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      return res.sendStatus(200);
    }

    const message = messages[0];
    const from = message.from;
    const text = message.text?.body;

    if (!text) return res.sendStatus(200);

    console.log(`📩 Mensaje de ${from}: ${text}`);

    // ── Inicializar conversación ──
    if (!conversaciones[from]) conversaciones[from] = [];

    const esNuevoCliente = conversaciones[from].length === 0;
    const saludo = obtenerSaludo();

    const systemConSaludo = esNuevoCliente
      ? SYSTEM_PROMPT + `\n\nEl cliente acaba de escribir por primera vez. Salúdalo con "${saludo}" al inicio de tu respuesta.`
      : SYSTEM_PROMPT;

    conversaciones[from].push({ role: 'user', content: text });

    // ── Alertas ──
    if (detectarIntencionDeposito(text)) {
      await enviarAlerta(from, obtenerResumen(conversaciones[from]));
    }
    if (detectarConsultaDisponibilidad(text)) {
      await enviarAlertaDisponibilidad(from, obtenerResumen(conversaciones[from]));
    }

    // ── Claude Haiku ──
    const claudeResponse = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemConSaludo,
        messages: conversaciones[from]
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
    conversaciones[from].push({ role: 'assistant', content: reply });
    console.log(`💬 Vera responde: ${reply}`);

    // ── Enviar respuesta por WhatsApp ──
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: from,
        type: 'text',
        text: { body: reply }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // ── Sincronizar con Chatwoot ──
    try {
      if (!contactosChatwoot[from]) {
        const contactId = await obtenerOCrearContacto(from, from);
        const conversationId = await obtenerOCrearConversacion(contactId, from);
        contactosChatwoot[from] = { contactId, conversationId };
      }

      const { conversationId } = contactosChatwoot[from];

      // Registrar mensaje entrante del cliente
      await enviarMensajeChatwoot(conversationId, text, true);

      // Registrar respuesta de VERA
      await enviarMensajeChatwoot(conversationId, reply, false);

    } catch (chatwootErr) {
      console.error('⚠️ Error Chatwoot (no crítico):', chatwootErr.message);
    }

    console.log(`✅ Respuesta enviada a ${from}`);
    res.sendStatus(200);

  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    res.sendStatus(500);
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.send('Vera - Finca Las Vírgenes está activa ✅');
});

const PORT = process.env.PORT || 3000; // Mantener servidor activo en Render (plan gratuito)
const https = require('https');
setInterval(() => {
  https.get('https://vera-server-gxdo.onrender.com', (res) => {
    console.log('🔄 Auto-ping: servidor activo');
  }).on('error', (err) => {
    console.log('⚠️ Auto-ping error:', err.message);
  });
}, 840000); // cada 14 minutos
app.listen(PORT, () => {
  console.log(`🌿 Vera corriendo en puerto ${PORT}`);
});

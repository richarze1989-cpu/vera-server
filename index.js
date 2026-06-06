const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = 'vera2024';

const conversaciones = {};

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
    'disponibilidad', 'disponible', 'hay espacio', 'tienen espacio',
    'está disponible', 'esta disponible', 'hay lugar', 'tienen lugar',
    'puedo reservar', 'se puede reservar', 'fechas disponibles',
    'habitación disponible', 'cabaña disponible', 'cuarto disponible'
  ];
  const textoLower = texto.toLowerCase();
  return palabras.some(p => textoLower.includes(p));
}

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
          text: { body: mensaje },
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );
      console.log(`✅ Alerta enviada a ${numero}`);
    } catch (err) {
      console.error(`❌ Error enviando alerta a ${numero}:`, err.response?.data || err.message);
    }
  }
}

async function enviarAlertaDisponibilidad(numeroCliente, resumenConversacion) {
  const mensaje = `📅 *CONSULTA DE DISPONIBILIDAD — Finca Las Vírgenes*\n\nUn cliente está preguntando por disponibilidad.\n\n*Número:* +${numeroCliente}\n\n*Resumen:*\n${resumenConversacion}\n\nPor favor verificar en Little Hotelier y confirmar al cliente.`;

  for (const numero of NUMEROS_ALERTA) {
    try {
      await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: 'whatsapp',
          to: numero,
          type: 'text',
          text: { body: mensaje },
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );
      console.log(`✅ Alerta de disponibilidad enviada a ${numero}`);
    } catch (err) {
      console.error(`❌ Error enviando alerta a ${numero}:`, err.response?.data || err.message);
    }
  }
}

function obtenerResumen(historial) {
  const mensajes = historial
    .slice(-6)
    .map(m => `${m.role === 'user' ? '👤 Cliente' : '🤖 Vera'}: ${m.content}`)
    .join('\n');
  return mensajes;
}

const SYSTEM_PROMPT = `Eres Vera, parte del equipo de atención de Finca Las Vírgenes, una finca turística premium ubicada en El Paraíso, Copán, Honduras.

Tu personalidad es cálida, resuelta, elegante y siempre encuentras una solución. Nunca dejas a un cliente sin respuesta. Representas el espíritu de la finca: paz, descanso, naturaleza y lujo simple.

Nunca menciones que eres un bot, inteligencia artificial o asistente virtual. Si alguien te pregunta directamente, responde que eres parte del equipo de atención al cliente de Finca Las Vírgenes.

Siempre inicia tu primer mensaje con el saludo apropiado según la hora actual en Honduras. En mensajes siguientes no repitas el saludo.

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

    if (!conversaciones[from]) {
      conversaciones[from] = [];
    }

    const esNuevoCliente = conversaciones[from].length === 0;
    const saludo = obtenerSaludo();

    const systemConSaludo = esNuevoCliente
      ? SYSTEM_PROMPT + `\n\nEl cliente acaba de escribir por primera vez. Salúdalo con "${saludo}" al inicio de tu respuesta.`
      : SYSTEM_PROMPT;

    conversaciones[from].push({ role: 'user', content: text });

    // Detectar intención de depósito
    if (detectarIntencionDeposito(text)) {
      const resumen = obtenerResumen(conversaciones[from]);
      await enviarAlerta(from, resumen);
      console.log(`🔔 Alerta de depósito enviada para ${from}`);
    }

    // Detectar consulta de disponibilidad
    if (detectarConsultaDisponibilidad(text)) {
      const resumen = obtenerResumen(conversaciones[from]);
      await enviarAlertaDisponibilidad(from, resumen);
      console.log(`📅 Alerta de disponibilidad enviada para ${from}`);
    }

    const claudeResponse = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemConSaludo,
        messages: conversaciones[from],
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
      }
    );

    const reply = claudeResponse.data.content[0].text;
    conversaciones[from].push({ role: 'assistant', content: reply });

    console.log(`💬 Vera responde: ${reply}`);

    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: from,
        type: 'text',
        text: { body: reply },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`✅ Respuesta enviada a ${from}`);
    res.sendStatus(200);

  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    res.sendStatus(500);
  }
});

app.get('/', (req, res) => {
  res.send('Vera - Finca Las Vírgenes está activa ✅');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌿 Vera corriendo en puerto ${PORT}`);
});

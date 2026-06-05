const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const VERIFY_TOKEN = 'vera2024';

const conversaciones = {};

const SYSTEM_PROMPT = `Eres Vera, la asistente virtual de Finca Las Vírgenes, una finca turística premium ubicada en El Paraíso, Copán, Honduras.

Tu personalidad es cálida, resuelta, elegante y siempre encuentras una solución. Nunca dejas a un cliente sin respuesta. Representas el espíritu de la finca: paz, descanso, naturaleza y lujo simple.

FLUJO DE CONVERSACIÓN:
Antes de presentar opciones de alojamiento, primero recopila:
1. Nombre del huésped
2. Número de personas (adultos y niños por separado)
3. Fechas de llegada y salida

Una vez que tengas esos datos, presenta las opciones más adecuadas.

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

TODOS LOS ALOJAMIENTOS INCLUYEN: desayuno, acceso a piscina, jardines y restaurante.

POLÍTICA DE RESERVAS:
- Se requiere 50% o 100% de anticipo para confirmar
- Check-in: 3:00 PM | Check-out: 11:00 AM
- Mascotas: máx 2, depósito reembolsable L.1,000

RESTAURANTE: Abierto al público de 11am a 9pm.

UBICACIÓN: El Paraíso, Copán, Honduras. Carretera CA4 hacia Copán Ruinas, desvío en Florida, Copán.

Responde siempre en español, de forma elegante y cálida. Si el cliente pregunta algo que no puedes resolver, indícale que lo comunicarás con el equipo de la finca.`;

// ✅ VERIFICACIÓN DE WEBHOOK — Meta llama este endpoint para verificar
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('Verificación de Meta recibida:', { mode, token, challenge });

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado correctamente');
    res.status(200).send(challenge);
  } else {
    console.log('Token de verificación incorrecto');
    res.sendStatus(403);
  }
});

// ✅ RECIBIR MENSAJES — Meta envía mensajes aquí
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

    console.log(`Mensaje de ${from}: ${text}`);

    // Historial de conversación
    if (!conversaciones[from]) {
      conversaciones[from] = [];
    }

    conversaciones[from].push({ role: 'user', content: text });

    // Llamar a Claude
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-20240307',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
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

    const reply = response.data.content[0].text;

    conversaciones[from].push({ role: 'assistant', content: reply });

    console.log(`Respuesta de Vera: ${reply}`);

    // Devolver respuesta a Make.com o al llamante
    res.status(200).json({ reply, to: from });

  } catch (error) {
    console.error('Error en webhook POST:', error.response?.data || error.message);
    res.sendStatus(500);
  }
});

app.get('/', (req, res) => {
  res.send('Vera - Finca Las Vírgenes está activa ✅');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Vera corriendo en puerto ${PORT}`);
});

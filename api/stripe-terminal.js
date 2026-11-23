import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { suite, amount } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ message: 'Invalid amount' });
  }

  try {
    const amountInCents = Math.round(amount * 100);

    // 1. Crea l'intenzione di pagamento su Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'eur',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      description: `Marinali Rooms - ${suite}`
    });

    const readerId = process.env.STRIPE_READER_ID;

    if (!readerId) {
      throw new Error('STRIPE_READER_ID non configurato nelle variabili Vercel.');
    }

    // 2. Invia l'istruzione di addebito al lettore S700
    await stripe.terminal.readers.processPaymentIntent(readerId, {
      payment_intent: paymentIntent.id
    });

    return res.status(200).json({
      success: true,
      message: 'Payment sent to Stripe S700 Reader',
      paymentIntentId: paymentIntent.id
    });

  } catch (error) {
    console.error('Stripe Terminal Error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error processing payment on Stripe Reader'
    });
  }
}

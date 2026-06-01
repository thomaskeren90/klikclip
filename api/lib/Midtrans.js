/**
 * Midtrans.js — Payment integration for VIO Studio
 *
 * - Snap token creation (client-side popup)
 * - Webhook signature verification (prevents fake notifications)
 * - Payment status helpers
 *
 * Environment variables:
 *   MIDTRANS_SERVER_KEY   (required)
 *   MIDTRANS_CLIENT_KEY   (required for frontend Snap popup)
 *   MIDTRANS_IS_PRODUCTION (default: false)
 */

const crypto = require('crypto');

let snap = null;

function getSnap() {
  if (snap) return snap;
  const MidtransClient = require('midtrans-client');
  snap = new MidtransClient.Snap({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY,
  });
  return snap;
}

/**
 * Credit packages in IDR
 */
const CREDIT_PACKAGES = [
  { id: 'starter', name: 'Starter', credits: 50, amountIdr: 29000, priceDisplay: 'Rp 29.000', popular: false },
  { id: 'pro', name: 'Pro', credits: 200, amountIdr: 79000, priceDisplay: 'Rp 79.000', popular: true },
  { id: 'agency', name: 'Agency', credits: 99999, amountIdr: 199000, priceDisplay: 'Rp 199.000', popular: false },
];

/**
 * Get package by id
 */
function getPackage(packageId) {
  return CREDIT_PACKAGES.find(p => p.id === packageId);
}

/**
 * Create a Midtrans Snap transaction
 * @returns {{ token: string, redirectUrl: string }}
 */
async function createSnapToken(orderId, packageId, user) {
  const pkg = getPackage(packageId);
  if (!pkg) throw new Error(`Invalid package: ${packageId}`);

  const parameter = {
    transaction_details: {
      order_id: orderId,
      gross_amount: pkg.amountIdr,
    },
    item_details: [{
      id: pkg.id,
      price: pkg.amountIdr,
      quantity: 1,
      name: `${pkg.name} - ${pkg.credits} Credits`,
    }],
    customer_details: {
      email: user.email,
      first_name: user.name || user.email.split('@')[0],
    },
    enabled_payments: ['credit_card', 'qris', 'gopay', 'shopeepay', 'ovo', 'bank_transfer'],
  };

  const result = await getSnap().createTransaction(parameter);

  return {
    token: result.token,
    redirectUrl: result.redirect_url,
  };
}

/**
 * Verify Midtrans webhook notification signature.
 * Formula: SHA512(order_id + status_code + gross_amount + server_key)
 */
function verifyWebhookSignature(orderId, statusCode, grossAmount, incomingHash) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
  const raw = `${orderId}${statusCode}${grossAmount}${serverKey}`;
  const expected = crypto.createHash('sha512').update(raw).digest('hex');
  return expected === incomingHash;
}

/**
 * Check if payment status means success
 */
function isPaymentSuccess(transactionStatus, fraudStatus) {
  if (transactionStatus === 'capture') return fraudStatus === 'accept';
  if (transactionStatus === 'settlement') return true;
  return false;
}

module.exports = {
  CREDIT_PACKAGES,
  getPackage,
  createSnapToken,
  verifyWebhookSignature,
  isPaymentSuccess,
};

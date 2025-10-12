// public/scripts/checkout.js
// Paddle v2-compatible checkout loader + pricing toggle

const toggle = document.getElementById('billing-toggle');
const labelEls = document.querySelectorAll('.js-billing-label');
const priceNT = document.querySelector('.js-nt-price');
const priceTV = document.querySelector('.js-tv-price');
const priceDual = document.querySelector('.js-dual-price');

console.log('[AcuTrader] checkout.js loaded');

// Update displayed prices when Monthly/Annual toggled
function applyPricing() {
  const annual = toggle?.checked;
  labelEls.forEach((el) => (el.textContent = annual ? 'year' : 'month'));
  if (annual) {
    // 39.99 * 12 * 0.7 ≈ 335 ; dual ≈ 504
    if (priceNT) priceNT.textContent = '335';
    if (priceTV) priceTV.textContent = '335';
    if (priceDual) priceDual.textContent = '504';
  } else {
    if (priceNT) priceNT.textContent = '39.99';
    if (priceTV) priceTV.textContent = '39.99';
    if (priceDual) priceDual.textContent = '59.99';
  }
}
applyPricing();
toggle && toggle.addEventListener('change', applyPricing);

// Lazy-load Paddle v2
let paddleReady = false;
async function loadPaddle() {
  if (paddleReady && window.Paddle) return window.Paddle;

  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });

  // Sandbox + initialize with your PUBLIC client token
  window.Paddle.Environment.set('sandbox'); // remove in production
  window.Paddle.Initialize({
    token: 'test_f2d749debb7c87af3996d052dfd',
  });

  paddleReady = true;
  return window.Paddle;
}

// Open checkout for a given *priceId* (v2)
async function openCheckout(priceId) {
  const Paddle = await loadPaddle();
  if (!priceId || priceId.startsWith('REPLACE')) {
    alert('Configure your Paddle price IDs on the buttons.');
    return;
  }

  const origin = window.location.origin; // e.g. https://acutrader-web.pages.dev

  Paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],

    // v2 SDK settings (client-side)
    settings: {
      displayMode: 'overlay',
      successUrl: `${origin}/thank-you`,
      cancelUrl: `${origin}/pricing`,
    },

    // some Paddle environments expect these under 'transaction' too
    transaction: {
      successUrl: `${origin}/thank-you`,
      cancelUrl: `${origin}/pricing`,
    },
  });
}


// Wire “Start” buttons
document.querySelectorAll('button[data-plan]').forEach((btn) => {
  btn.addEventListener('click', () => {
    console.log('[AcuTrader] plan button clicked', btn.dataset.plan);
    const annual = toggle?.checked;
    const priceId = annual ? btn.dataset.annualProduct : btn.dataset.monthlyProduct;
    openCheckout(priceId);
  });
});

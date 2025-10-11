// public/scripts/checkout.js
// Paddle v2-compatible checkout loader + pricing toggle

const toggle = document.getElementById('billing-toggle');
const labelEls = document.querySelectorAll('.js-billing-label');
const priceNT = document.querySelector('.js-nt-price');
const priceTV = document.querySelector('.js-tv-price');
const priceDual = document.querySelector('.js-dual-price');

// Update displayed prices when Monthly/Annual toggled
function applyPricing() {
  const annual = toggle?.checked;
  labelEls.forEach(el => (el.textContent = annual ? 'year' : 'month'));
  if (annual) {
    // 39.99 * 12 * 0.7 ≈ 335 ; dual 59.99 * 12 * 0.7 ≈ 504
    priceNT && (priceNT.textContent = '335');
    priceTV && (priceTV.textContent = '335');
    priceDual && (priceDual.textContent = '504');
  } else {
    priceNT && (priceNT.textContent = '39.99');
    priceTV && (priceTV.textContent = '39.99');
    priceDual && (priceDual.textContent = '59.99');
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
  window.Paddle.Environment.set('sandbox'); // remove/disable in production
  window.Paddle.Initialize({
    token: 'test_f2d749debb7c87af3996d052dfd', // keep quotes
  });

  // Helpful console logging while testing
  window.Paddle.Events.on('checkout.loaded', (e) => console.log('Paddle loaded', e));
  window.Paddle.Events.on('checkout.completed', (e) => console.log('Paddle completed', e));
  window.Paddle.Events.on('checkout.error', (e) => console.error('Paddle error', e));

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
  Paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    // You can optionally pass customer: { email: 'test@example.com' }
    // and settings: { displayMode: 'overlay' } (overlay is default)
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
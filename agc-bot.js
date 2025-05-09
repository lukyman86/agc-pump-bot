require('dotenv').config();
const axios = require('axios');
const fetch = require('node-fetch');
const fs = require('fs');
const bs58 = require('bs58');
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} = require('@solana/web3.js');

const RPC_URL = 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL);

const PRIVATE_KEY_BASE58 = process.env.PRIVATE_KEY_BASE58;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const privateKeyBytes = bs58.decode(PRIVATE_KEY_BASE58);
const wallet = Keypair.fromSecretKey(privateKeyBytes);

const AGC_MINT = new PublicKey('9J4JXu7Tz7SShZesbSRGWbTaBFhSnYvBxaQNbi72pump');
const PUMP_API = \`https://pump.fun/api/coin/\${AGC_MINT.toBase58()}\`;
const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

const BUY_AMOUNT_SOL = 0.01;
const SLIPPAGE = 10;
const SELL_PERCENTAGE = 100;
const CHECK_INTERVAL_MS = 15000;

let buyPrice = null;
let totalProfit = 0;

const [BONDING_ADDRESS] = PublicKey.findProgramAddressSync(
  [Buffer.from('bonding-curve'), AGC_MINT.toBuffer()],
  PUMP_FUN_PROGRAM_ID
);

async function sendTelegramMessage(message) {
  try {
    await axios.post(\`https://api.telegram.org/bot\${TELEGRAM_BOT_TOKEN}/sendMessage\`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
    });
  } catch (e) {
    console.error('Telegram error:', e.message);
  }
}

function logReport({ buy, sell, diff, percent }) {
  const now = new Date().toISOString();
  const line = \`=== Laporan Transaksi ===
Waktu: \${now}
Harga Beli: \${buy} SOL
Harga Jual: \${sell} SOL
Keuntungan: \${diff.toFixed(6)} SOL (\${percent.toFixed(2)}%)
-------------------------
\`;
  fs.appendFileSync('report.txt', line);
}

async function buyAGC() {
  const lamports = BUY_AMOUNT_SOL * LAMPORTS_PER_SOL;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: BONDING_ADDRESS,
      lamports,
    })
  );

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log(\`✅ Beli AGC berhasil! Tx: https://solscan.io/tx/\${sig}\`);
    const res = await axios.get(PUMP_API);
    buyPrice = res.data.price;
    console.log(\`💵 Harga beli: \${buyPrice}\`);
    await sendTelegramMessage(\`[BOT] Pembelian AGC sukses
Harga beli: \${buyPrice} SOL\`);
  } catch (e) {
    console.error('❌ Gagal beli:', e.message);
  }
}

async function sellAGC() {
  const url = 'https://api.pumpfunapis.com/api/sell';
  const payload = {
    private_key: PRIVATE_KEY_BASE58,
    mint: AGC_MINT.toBase58(),
    percentage: SELL_PERCENTAGE,
    slippage: SLIPPAGE,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(await response.text());

    const data = await response.json();
    const res = await axios.get(PUMP_API);
    const sellPrice = res.data.price;
    const diff = sellPrice - buyPrice;
    const percent = (diff / buyPrice) * 100;
    totalProfit += diff;

    logReport({ buy: buyPrice, sell: sellPrice, diff, percent });

    console.log('✅ Token berhasil dijual!');
    console.log(\`🔗 Tx: https://solscan.io/tx/\${data.tx_signature}\`);
    await sendTelegramMessage(\`[BOT] Penjualan AGC sukses
Harga jual: \${sellPrice} SOL
Keuntungan: \${diff.toFixed(6)} SOL (\${percent.toFixed(2)}%)\`);
  } catch (error) {
    console.error('❌ Gagal jual token:', error.message);
  }
}

async function monitorPrice() {
  if (!buyPrice) return;

  try {
    const res = await axios.get(PUMP_API);
    const currentPrice = res.data.price;
    const diff = ((currentPrice - buyPrice) / buyPrice) * 100;

    console.log(\`📈 Harga sekarang: \${currentPrice} (\${diff.toFixed(2)}%)\`);

    if (diff >= 30 || diff <= -20) {
      console.log(diff > 0 ? '🎯 Take profit triggered!' : '🛑 Stop loss triggered!');
      await sellAGC();
      process.exit();
    }
  } catch (e) {
    console.error('❌ Gagal ambil harga:', e.message);
  }
}

(async () => {
  console.log(\`🤖 Memulai bot trading AGC untuk wallet: \${wallet.publicKey.toBase58()}\`);
  console.log(\`🔗 Bonding Address AGC: \${BONDING_ADDRESS.toBase58()}\`);
  await buyAGC();
  setInterval(monitorPrice, CHECK_INTERVAL_MS);
})();

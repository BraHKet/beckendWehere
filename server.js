// backend/server.js

require('dotenv').config(); // Carica le variabili da .env
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5001;

// --- Selezione Ambiente ---
const isProduction = process.env.EBAY_API_ENV === 'production';
console.log(`Ambiente API eBay selezionato: ${isProduction ? 'PRODUCTION' : 'SANDBOX'}`);

// --- URL API Base Dinamici ---
const EBAY_API_BASE_URL = isProduction
    ? 'https://api.ebay.com' // URL Produzione
    : 'https://api.sandbox.ebay.com'; // URL Sandbox

const EBAY_IDENTITY_URL = `${EBAY_API_BASE_URL}/identity/v1/oauth2/token`;
const EBAY_BROWSE_URL = `${EBAY_API_BASE_URL}/buy/browse/v1`;

// --- Credenziali Dinamiche per l'ambiente selezionato ---
const EBAY_CLIENT_ID = isProduction
    ? process.env.EBAY_PRODUCTION_CLIENT_ID
    : process.env.EBAY_SANDBOX_CLIENT_ID;
const EBAY_CLIENT_SECRET = isProduction
    ? process.env.EBAY_PRODUCTION_CLIENT_SECRET
    : process.env.EBAY_SANDBOX_CLIENT_SECRET;

// --- ID Categoria Abbigliamento eBay ---
// Nota: questo dovrebbe essere l'ID corretto per l'abbigliamento su eBay
// Se necessario, aggiornalo all'ID categoria corretto
const CLOTHING_CATEGORY_ID = '11450'; // Vestiario e accessori (potrebbe essere diverso in base al marketplace)

// === Configurazione CORS ===
const corsOptions = {
    origin: 'http://localhost:3000',
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// === Gestione Token eBay (aggiornata per ambiente) ===
let ebayToken = null;
let tokenExpiryTime = 0;
const tokenBufferSeconds = 300;

async function getEbayToken() {
    const now = Date.now();
    if (ebayToken && tokenExpiryTime > now + tokenBufferSeconds * 1000) {
        console.log(`Usando token eBay dalla cache (${isProduction ? 'Prod' : 'Sandbox'}).`);
        return ebayToken;
    }

    console.log(`Richiesta nuovo token eBay (${isProduction ? 'Production' : 'Sandbox'})...`);

    // Usa le credenziali selezionate dinamicamente
    if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) {
        console.error(`ERRORE: Client ID o Client Secret eBay per l'ambiente ${isProduction ? 'PRODUCTION' : 'SANDBOX'} non trovati nel file .env`);
        // Aggiunto log per vedere cosa viene letto esattamente
        console.log("DEBUG - EBAY_CLIENT_ID letto:", EBAY_CLIENT_ID);
        console.log("DEBUG - EBAY_CLIENT_SECRET letto:", EBAY_CLIENT_SECRET);
        throw new Error("Credenziali eBay non configurate sul server per l'ambiente corrente.");
    }

    const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');

    try {
        const response = await axios.post(
            EBAY_IDENTITY_URL, // Usa URL Identità corretto (Prod o Sandbox)
            'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${credentials}`
                }
            }
        );

        ebayToken = response.data.access_token;
        tokenExpiryTime = now + (response.data.expires_in * 1000);
        console.log(`Nuovo token eBay (${isProduction ? 'Prod' : 'Sandbox'}) ottenuto. Scade:`, new Date(tokenExpiryTime).toLocaleString());
        return ebayToken;

    } catch (error) {
        console.error(`Errore durante l'ottenimento del token eBay (${isProduction ? 'Prod' : 'Sandbox'}):`, error.response?.data || error.message);
        ebayToken = null;
        tokenExpiryTime = 0;
        // Rilancia l'errore originale ma con un messaggio più specifico
        throw new Error(`Impossibile ottenere il token di accesso eBay per ${isProduction ? 'Production' : 'Sandbox'}. Dettagli: ${error.message}`);
    }
}

// === Endpoint Proxy per la Ricerca eBay (aggiornato per ambiente e categoria abbigliamento) ===
app.get('/api/ebay/search', async (req, res) => {
    // Estraiamo tutti i parametri di ricerca (query, limite e offset per paginazione)
    const { q = '', limit = 20, offset = 0, category = CLOTHING_CATEGORY_ID } = req.query;
    
    // Costruiamo i parametri per l'API eBay
    const searchParams = {
        limit: parseInt(limit),
        offset: parseInt(offset)
    };
    
    // Se è fornita una query di ricerca, la includiamo
    if (q && q.trim() !== '') {
        searchParams.q = q.trim();
    }
    
    // Aggiungiamo sempre il filtro per categoria abbigliamento
    searchParams.category_ids = category;

    try {
        const token = await getEbayToken();
        // Usa l'URL Browse corretto (Prod o Sandbox)
        const searchUrl = `${EBAY_BROWSE_URL}/item_summary/search`;

        console.log(`Backend (${isProduction ? 'Prod' : 'Sandbox'}): Eseguo ricerca eBay per ${JSON.stringify(searchParams)}`);

        const ebayResponse = await axios.get(searchUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-EBAY-C-MARKETPLACE-ID': process.env.EBAY_MARKETPLACE_ID || (isProduction ? 'EBAY-US' : 'EBAY-US') // Default a US se non specificato
            },
            params: searchParams
        });

        res.json(ebayResponse.data);

    } catch (error) {
        // Mantenuta la gestione errore originale
        console.error(`Errore nel proxy di ricerca eBay (${isProduction ? 'Prod' : 'Sandbox'}) per params=${JSON.stringify(searchParams)}:`, error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            message: "Errore durante la comunicazione con l'API di eBay.",
            details: error.response?.data || error.message // Includi i dettagli dell'errore da eBay se disponibili
        });
    }
});

// === Endpoint Proxy per Dettaglio Oggetto eBay (non modificato) ===
app.get('/api/ebay/item/:itemId', async (req, res) => {
    const { itemId } = req.params;

    // Mantenuto il controllo sull'itemId
    if (!itemId) {
        return res.status(400).json({ error: 'eBay Item ID mancante nell\'URL.' });
    }

    try {
        const token = await getEbayToken();
         // Usa l'URL Browse corretto (Prod o Sandbox)
        const itemUrl = `${EBAY_BROWSE_URL}/item/${itemId}`;

        console.log(`Backend (${isProduction ? 'Prod' : 'Sandbox'}): Recupero dettagli per eBay item ${itemId}`);

        const ebayResponse = await axios.get(itemUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-EBAY-C-MARKETPLACE-ID': process.env.EBAY_MARKETPLACE_ID || (isProduction ? 'EBAY-US' : 'EBAY-US')
            }
         });

        res.json(ebayResponse.data);

    } catch (error) {
        // Mantenuta la gestione errore originale
        console.error(`Errore nel proxy dettaglio item eBay (${isProduction ? 'Prod' : 'Sandbox'}) ${itemId}:`, error.response?.data || error.message);
         res.status(error.response?.status || 500).json({
            message: "Errore durante la comunicazione con l'API di eBay per i dettagli dell'oggetto.",
            details: error.response?.data || error.message // Includi i dettagli dell'errore da eBay se disponibili
        });
    }
});


// === Avvio del Server ===
app.listen(PORT, () => {
    console.log(`🚀 Server backend in ascolto sulla porta ${PORT}`);
    console.log(`Frontend React atteso su http://localhost:3000`);
    getEbayToken(); // Prova a ottenere un token all'avvio per l'ambiente selezionato
});
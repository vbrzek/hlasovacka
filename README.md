# Hlasovačka – interaktivní prezentace s hlasováním

Jednoduchá náhrada Mentimeteru: statické slajdy (obrázek + text) a otázky s výběrem jedné možnosti a živými výsledky.

## Spuštění

```bash
npm install
npm start            # http://localhost:3000
```

Proměnné prostředí:

| proměnná     | výchozí    | význam |
|--------------|------------|--------|
| `PORT`       | `3000` (v PM2 `3210`) | port serveru |
| `HOST`       | všechna rozhraní (v PM2 `127.0.0.1`) | adresa, na které server poslouchá |
| `DATA_DIR`   | `./data`   | kam se ukládají prezentace (JSON) a nahrané obrázky |
| `PUBLIC_URL` | –          | veřejná adresa, např. `https://hlasovani.example.cz`; použije se v QR kódu. Bez ní se adresa odvodí z hlavičky Host. |

## Nasazení na server (PM2)

```bash
git clone https://github.com/vbrzek/hlasovacka.git && cd hlasovacka
npm ci --omit=dev
cp .env.example .env        # nastavte PORT (výchozí 3210), PUBLIC_URL, případně HOST
npm run pm2:start           # = pm2 start ecosystem.config.js
pm2 save                    # zapamatovat procesy
pm2 startup                 # jednorázově: automatický start po rebootu (vypíše příkaz k provedení)
```

Další užitečné příkazy:

```bash
npm run pm2:logs            # logy
git pull && npm ci --omit=dev && npm run pm2:restart   # aktualizace (načte i změny v .env)
```

Výchozí `HOST=127.0.0.1` znamená, že aplikace je dostupná jen přes reverzní proxy na stejném stroji (viz nginx níže). Pro přímý přístup zvenku nastavte `HOST=0.0.0.0`.

## Jak to funguje

Na titulní stránce kdokoli založí prezentaci a dostane tři odkazy (tokeny slouží jako klíče):

- **Administrace** `/a/<token>`: úprava slajdů, nahrávání obrázků a ovládání promítání (šipky / PageUp / PageDown, funguje i s prezentérem). Odkaz nikomu nedávejte.
- **Plátno** `/s/<token>`: scéna 1920×1080 bez ovládacích prvků, která se škáluje na velikost okna. Pro OBS stačí Browser Source 1920×1080.
- **Hlasování** `/v/<kód>`: mobilní stránka, na kterou vede QR kód. Dokud neběží otázka, ukazuje úvodní grafiku a text „Hlasování nebylo zahájeno“.

Pozice „Úvod s QR kódem“ (před prvním slajdem) zobrazí velký QR kód s adresou pro hlasování. U otázek může být malý QR kód i v rohu.

Každý telefon (podle ID v localStorage) může u otázky hlasovat jednou. Po hlasování vidí živé výsledky.

## Provoz na eventu

- Aplikace musí běžet jako **jedna instance** (`ecosystem.config.js` to tak má nastavené; neměňte na cluster mód), protože stav je v paměti procesu. Na disk se ukládá snapshot nejvýš jednou za 1,5 s a hned při ukončení procesu.
- Výsledky se rozesílají dávkově (max. ~3× za sekundu), ne po každém hlasu.
- Za reverzní proxy je potřeba povolit WebSockety. Pro nginx:

  ```nginx
  location / {
    proxy_pass http://127.0.0.1:3210;   # = PORT z .env
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 1h;
  }
  client_max_body_size 16m;
  ```

- Limit otevřených souborů (`ulimit -n`, v systemd `LimitNOFILE=65535`) by měl být nad 1024.
- Živá zkouška s virtuálním publikem na existující prezentaci: `node scripts/simulate.js <admin URL> 500 10 20` (počet hlasujících, minut, rozptyl hlasování v s). Hlasují, kdykoli přepnete na otázku; hlasy pak vynulujte v administraci.
- Zátěžový test: `npm run loadtest -- http://localhost:3000 500`. Lokálně vyšlo: 500 klientů, přepnutí slajdu doručeno všem za ~16 ms, 500 hlasů zpracováno za ~40 ms.

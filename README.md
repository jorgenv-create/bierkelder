# De Bierkelder

Een Nederlandstalige webapp om je biercollectie bij te houden op je eigen server. Je bewaart per aankoop het aantal flessen, de winkel, prijs, jaargang en je geplande drinkvenster. De app ondersteunt barcodescans, eigen foto's, Untappd-links, voorraadschattingen en JSON-back-ups.

## Start met Docker Compose

Kloon of download deze repository. Maak in de projectmap een bestand `.env` met deze regel.

```dotenv
ALLOW_SETUP=true
```

Start de app.

```sh
docker compose up -d --build
```

Open [http://127.0.0.1:3080](http://127.0.0.1:3080) op de computer waarop Docker draait en maak je eigen account. Zet daarna `ALLOW_SETUP=false` in `.env` en voer `docker compose up -d` opnieuw uit. De app gebruikt één account per installatie.

### Via een eigen HTTPS-adres

Gebruik na de eerste installatie een reverse proxy met TLS voor toegang vanaf je telefoon. Stel `PUBLIC_ORIGIN` in `.env` in op het exacte externe adres, bijvoorbeeld `https://bier.example.com`, zonder afsluitende slash. Laat de proxy de originele `Host` doorgeven en stuur HTTP-bezoekers door naar HTTPS. De proxy moet de backend kunnen bereiken via de hostpoort of een gedeeld Docker-netwerk. De meegeleverde poortkoppeling is alleen op de Docker-host bereikbaar. Voor een server zonder eigen browser kun je de eerste installatie via een SSH-tunnel naar die poort doen.

De barcodescanner gebruikt de camera op je toestel en vereist HTTPS of een loopbackadres. Bij een opzoeking gaat de barcode naar Open Food Facts en zo nodig naar UPCitemdb. Eigen foto's worden lokaal in je Bierkelder bewaard. Winkelprijzen zijn gedateerde schattingen voor geselecteerde bieren. Als er geen passende winkelprijs beschikbaar is, kan de app je aankoopprijs gebruiken.

## Data en back-ups

De database, foto's en het account staan in het Docker-volume `bierkelder-data`. Een normale herbouw laat dit volume intact. Download via de app een JSON-back-up van je collectie en foto's. Voor een back-up inclusief account stop je de container en maak je een back-up van het volledige volume. `docker compose down -v` verwijdert de database.

## Winkelprijzen en prijsgeschiedenis

Met **Winkelprijzen verversen** vergelijk je je volledige voorraad met de openbare productcatalogi van Huis van de Geuze en Geuzeshop. De app zoekt per brouwerij, bier, flesinhoud en jaargang. Alleen een leverbare match met een europrijs telt als winkelprijs. Zonder match telt de aankoopprijs mee als die ingevuld is. Klik op een winkelprijs om de productpagina te openen.

In **Prijsgeschiedenis** zie je per fles de laagste gevonden winkelprijs per controle, met datum en bron. De eerste controle begint de geschiedenis. De metingen staan in SQLite en vallen onder een back-up van het volledige volume. Via **Zoek deze fles op het web** kun je ook buiten de gekoppelde catalogi zoeken.

## Openbare collectie

Met `PUBLIC_COLLECTION=true` in `.env` kun je bezoekers op je startpagina je biernamen, brouwerijen, stijlen en jaargangen laten zien. Aankoopgegevens, aantallen, foto's, notities en prijsgeschiedenis zijn afgeschermd. Je beheert de kelder na inloggen. De openbare collectie staat standaard uit.

## Ontwikkelen

Gebruik Node.js 24 en voer het volgende uit.

```sh
npm ci
npm run build
npm test
```

Start desgewenst daarna `npm start` met `DATA_DIR` op een schrijfbare map, `PORT=3080`, `LOCAL_ORIGIN=http://127.0.0.1:3080` en tijdens de eerste installatie `ALLOW_SETUP=true`.

## Docker Hub publiceren

Maak een publieke `bierkelder`-repository onder je eigen Docker Hub-account. Stel in GitHub Actions de repositoryvariabele `DOCKERHUB_USERNAME` en het geheim `DOCKERHUB_TOKEN` in. Gebruik voor het geheim een Docker Hub-token met lees- en schrijfrechten. Start daarna de workflow **Docker** handmatig vanaf `main`. Die test de image en publiceert de versie uit `package.json` en de tag `latest` voor Linux op AMD64 en ARM64.

## Licentie

[MIT](LICENSE). Productinformatie van [Open Food Facts](https://world.openfoodfacts.org/) valt onder de [ODbL](https://opendatacommons.org/licenses/odbl/1-0/). De bijbehorende productafbeeldingen vallen onder CC BY-SA. Voor gegevens en afbeeldingen van andere bronnen gelden de voorwaarden van die bronnen.

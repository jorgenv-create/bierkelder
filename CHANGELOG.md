# Changelog

## 1.1.0 · 8 november 2026

### Collectie

- Groepen standaard, met een schakelaar naar losse bierkaarten en sortering op jaargang.
- Per bier keuze tussen een online afbeelding en de eigen foto.
- Optionele openbare collectie met kaarten, groepen, foto’s en algemene Untappd-scores. Aankoopgegevens, notities, persoonlijke scores en prijzen blijven afgeschermd.

### Untappd en wishlist

- Synchronisatie via de browserextensie, met handmatige keuze bij onzekere matches.
- Algemene en persoonlijke Untappd-scores op de collectiekaart, met beschikbare bierinformatie.
- Wishlist-knop op Untappd en detailkaarten met afbeelding, stijl, alcohol, bitterheid, score, beschrijving en gezochte jaargangen.
- Voorstellen voor ontbrekende jaren tussen twee jaargangen die al in de kelder liggen.

### Winkelprijzen

- Exacte jaargang eerst, met een herkenbare terugval naar een winkelprijs zonder jaartal.
- Extra winkelbronnen voor Liefmans Goudenband van 33 en 75 cl.
- Prijsgrafiek op de bierkaart en uitgebreider prijsoverzicht met bron, minimum, maximum en prijsverandering.

### Bijwerken

- Behoud je Docker-volume en voer opnieuw docker compose up -d --build uit. De nieuwe velden worden bij het starten aan SQLite toegevoegd.
- Download de Untappd-extensie vanuit je eigen Bierkelder. De build koppelt de extensie aan PUBLIC_ORIGIN of het standaard loopbackadres.

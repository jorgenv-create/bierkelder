# Updates via GitHub

Elke push naar main bouwt en test een Docker-image. Alleen een geslaagde build publiceert naar ghcr.io/jorgenv-create/bierkelder:latest. Er zijn ook versietags en sha-tags voor terugzetten.

## Bestaande Unraid-container eenmalig koppelen

Maak eerst een back-up van de bestaande data, inclusief bierkelder.sqlite en eventuele WAL-bestanden (of een SQLite online-back-up). Bewaar de bestaande containerinstellingen.

Open Docker > bierkelder > Edit. Wijzig Repository naar ghcr.io/jorgenv-create/bierkelder:latest. Behoud alle poorten, /data-mapping en omgevingsvariabelen, waaronder PUBLIC_ORIGIN, LOCAL_ORIGIN en PUBLIC_COLLECTION. Apply haalt de image op en maakt de container opnieuw aan met dezelfde gegevensmap. Verwijder de gegevensmap nooit.

Als GHCR om aanmelden vraagt, controleer bij het GitHub-package of het openbaar is, zoals de repository. Publiceer geen account- of collectiegegevens.

## Volgende updates

Na een groene GitHub Actions-build: Unraid > Docker > Check for Updates > Update bij bierkelder. Vernieuw de website na de update.

## Wishlist naar collectie

Open een bier op de wishlist en kies Toevoegen aan collectie. Het gewone aankoopformulier opent met biergegevens, afbeelding en Untappd-link. Vul aantal, prijs, winkel, flesinhoud en jaargang aan en sla op. Eén gezochte jaargang wordt vooraf ingevuld; bij meerdere kies je zelf de gekochte jaargang. De wishlist blijft behouden. Annuleren slaat niets op.

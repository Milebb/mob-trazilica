# Mob Trazilica

Jednostavna web aplikacija: velika strelica prema drugoj osobi, gore/dolje po visini (GPS).

## Brzo prije odlaska u trgovinu

1. Na **oba** mobitela otvori isti link (vidi dolje).
2. Unesi **isti tajni kod** i različita imena.
3. Dozvoli **lokaciju** i na iPhoneu **kompas** (pokret senzora).
4. Drži ekran okomito — strelica pokazuje smjer.

### Pokretanje lokalno (Wi‑Fi kod kuće)

```powershell
cd "C:\Users\mileb\Mob Trazilica"
py -m http.server 8080
```

Na mobitelu (isti Wi‑Fi): `http://TVoja-IP:8080` (npr. `http://192.168.1.5:8080`).

### Na javnoj mreži (van kuće)

Stavi folder na besplatni hosting (npr. Netlify drag-and-drop) ili GitHub Pages — treba **HTTPS** da kompas radi.

## Napomene

- **Visina / sprat**: GPS visina je gruba (~2–5 m). U zatvorenom često nema visine — koristi udaljenost i strelicu.
- **Privatnost**: Kod sobe = lozinka; ne koristi očigledan kod.

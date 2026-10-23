# Desk IA — Bitcoin, Nasdaq-100, Euro/Dollaro

Un desk di trading con **soldi finti e prezzi veri** che gira gratis e da solo su GitHub, una volta al giorno.

- **3 sale trading** da $10.000 finti: Bitcoin, Nasdaq-100 ed Euro/Dollaro (leva 3). Tutti i trader di una sala usano la strategia **campione**.
- **3 reparti ricerca**: ognuno prova 18 strategie su tutto lo storico (Bitcoin dal 2015, Nasdaq ed euro-dollaro dal 2012) e le segue ogni giorno in avanti.
- **Revisione ogni 3 mesi**: una strategia diventa campione solo se il *metodo di scelta* ha battuto il benchmark **fuori campione**, cioè rimettendo il reparto ricerca nel passato e facendolo decidere solo con i dati disponibili in quel momento. Altrimenti la sala resta sul benchmark.
- **Retrocessione**: se il campione fa peggio del benchmark di oltre 5 punti dopo 20 giorni di borsa, si torna al benchmark fino alla revisione successiva.
- **Benchmark**: compro e tengo per Bitcoin e Nasdaq, liquidità (0%) per l'euro-dollaro.

Nessun ordine reale viene mai inviato e non serve nessuna chiave o password.

## Cosa c'è dentro

| File | A cosa serve |
|---|---|
| `research.js` | Il reparto ricerca: le 18 strategie, i costi, la verifica fuori campione |
| `desk.js` | Il giro giornaliero: prezzi, revisioni, retrocessioni, risultati |
| `.github/workflows/desk.yml` | Dice a GitHub di fare un giro ogni giorno alle 02:23 ora italiana (01:23 d'inverno) |
| `docs/index.html` | La dashboard con la sala trading e i reparti ricerca |
| `docs/data/` | Prezzi salvati e risultati (si riempie da solo) |

## Come metterlo online (circa 15 minuti, meglio da computer)

1. **Crea un account gratuito** su [github.com](https://github.com).
2. In alto a destra premi **+** → **New repository**. Nome: `desk-ia`. Scegli **Public** (le pagine gratuite di GitHub funzionano solo con i repository pubblici; dentro ci sono solo soldi finti). Premi **Create repository**.
3. Nella pagina del repository premi **uploading an existing file**, trascina **tutto il contenuto** della cartella `desk-ia-v2` (non la cartella stessa) e premi **Commit changes**.
   - ⚠️ La cartella `.github` è "nascosta" e su alcuni computer non viene caricata. Controlla che nel repository compaia `.github/workflows/desk.yml`. Se manca: **Add file** → **Create new file**, scrivi come nome `.github/workflows/desk.yml`, incolla il contenuto del file `desk.yml` e premi **Commit changes**.
4. **Permessi**: **Settings** → **Actions** → **General** → in fondo, alla voce *Workflow permissions*, scegli **Read and write permissions** e premi **Save**.
5. **Dashboard**: **Settings** → **Pages** → *Source*: **Deploy from a branch**. *Branch*: **main** e cartella **/docs**. Premi **Save**.
6. **Primo giro**: scheda **Actions** → se te lo chiede, abilita i workflow → clicca **Desk IA - giro giornaliero** → **Run workflow**. Il primo giro scarica tutto lo storico e dura 1–2 minuti. Alla fine deve comparire una spunta verde.
7. Apri la dashboard su `https://TUO-NOME-UTENTE.github.io/desk-ia/` (la prima pubblicazione può richiedere qualche minuto). Puoi aggiungerla alla schermata Home del telefono come una app.

Da qui in poi gira da solo, anche con telefono e computer spenti.

## Se qualcosa non va

- **Croce rossa in Actions**: apri il giro fallito e leggi le ultime righe. Di solito una fonte di prezzi non risponde: riprova più tardi con **Run workflow**.
- **Un asset "SALTATO"**: nessuna fonte ha risposto per quell'asset; gli altri due continuano. Al giro dopo di solito si sistema.
- **"FERMO DA…" sulla dashboard**: GitHub può sospendere i giri automatici dopo 60 giorni senza attività. Vai su **Actions** e riattiva il workflow.
- **Ricominciare da zero**: cancella `docs/data/desk.json` e `docs/data/view.json` (i prezzi salvati possono restare), poi lancia un giro a mano.

## Le regole del gioco

- Le regole sono fisse: non cambiarle finché non sono passate almeno due revisioni (6 mesi). Se le ritocchi ogni volta che un mese va male, non saprai mai se funzionano.
- Il risultato che conta è il confronto con il benchmark dopo molti mesi, non quello di una settimana.
- Si opera alla chiusura di ogni giorno: è un'ipotesi leggermente ottimistica rispetto alla realtà.

Non è consulenza finanziaria.

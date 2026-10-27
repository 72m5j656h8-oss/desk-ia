# "Il cliente che ha fretta" — episodio pilota del canale (vita da cameriere, personaggi 3D)
# who: w = cameriere (narratore/protagonista), c = cliente
# key: parola evidenziata nei sottotitoli; shot: inquadratura; act: azione
LINES = [
    dict(who="w", text="Sabato sera. Sala piena.", key="piena", shot="wide", act="idle"),
    dict(who="w", text="Si siede uno, e mi dice:", key="dice", shot="wide", act="idle"),
    dict(who="c", text="Capo, ho fretta. Cosa fate di veloce?", key="fretta", shot="cust", act="gesture"),
    dict(who="w", text="Gli consiglio la pizza. Dieci minuti.", key="Dieci", shot="waiter", act="write"),
    dict(who="c", text="Perfetto!", key="Perfetto!", shot="cust", act="thumb"),
    dict(who="w", text="Poi, apre il menù.", key="menù", shot="wide", act="menu"),
    dict(who="w", text="Venti minuti dopo.", key="Venti", shot="card", act="menu"),
    dict(who="c", text="Scusi, che differenza c'è, tra margherita e marinara?", key="marinara", shot="cust", act="menu"),
    dict(who="w", text="Per la terza volta.", key="terza", shot="waiter_close", act="stare"),
    dict(who="c", text="Allora... prendo la carbonara.", key="carbonara", shot="cust", act="menu_close"),
    dict(who="w", text="Quella che ci vuole mezz'ora.", key="mezz'ora", shot="waiter_close", act="stare"),
    dict(who="c", text="Però veloce, eh! Ho fretta.", key="fretta.", shot="two", act="gesture"),
    dict(who="w", text="Scrivimi nei commenti il tuo cliente peggiore.", key="peggiore.", shot="cam", act="cam"),
]

// Sprachausgabe (Web Speech API) und Warntöne (Web Audio).
// iOS: Sprachausgabe startet erst, nachdem einmal per Tipp etwas gesprochen wurde
// -> unlock() bei einem Tipp aufrufen (z. B. „Spiel starten“).

import { getSettings } from '../core/settings.js';

const DE = {
  label: 'Deutsch', voiceLang: 'de',
  triple: 'Triple', double: 'Doppel', bull: 'Bullseye', outerBull: 'fünfundzwanzig', miss: 'Daneben',
  bust: 'Überworfen', noScore: 'Kein Punkt', rest: 'Rest', game: 'Game shot', leg: 'und das Leg', set: 'und das Set', match: 'und das Match',
  youRequire: (n) => `Rest ${n}`, cameraLost: 'Achtung, Kamera hat das Board verloren', next: (name) => `${name} ist dran`,
  test: 'Triple zwanzig. Einhundertachtzig.',
  // Cricket und Training
  marks: (n) => (n === 1 ? 'Ein Mark' : `${n} Marks`), hits: (n) => (n === 1 ? 'Ein Treffer' : `${n} Treffer`),
  target: (x) => `Ziel ${x}`, darts: (n) => `${n} Darts`, points: (n) => `${n} Punkte`,
  trainingDone: 'Training beendet', failed: 'Nicht geschafft', out: 'Ausgeschieden', shanghai: 'Shanghai!',
};

// Dialekte: Deutsch als Grundlage, die Aussprache steckt in der Schreibweise.
// quips = Sprüche nach der Aufnahme (Einstellung „Sprüche“): s180, ton (ab 100), low (1–20),
// zero (0 Punkte), bust, game. Je Anlass wird zufällig einer gewählt.
const DIALECTS = {
  bay: {
    label: 'Bayerisch', rate: 0.95,
    triple: 'Dripple', double: 'Dobbe', bull: 'Bullseye, Himmiherrgott', outerBull: 'fümfazwanzge', miss: 'Danebm',
    bust: 'Iwaworfa', noScore: 'Nix, goa nix', leg: 'und des Leg', set: 'und des Set', match: 'und des Match',
    youRequire: (n) => `Brauchst no ${n}`, cameraLost: 'Obacht, de Kamera siagt nix mehr', next: (name) => `${name}, jetzt bist du dro`,
    test: 'Dripple zwanzg. Hundertachtzg, Kruzifix!',
    quips: {
      s180: ['Ja Kruzifix, hundertachtzge!', 'Do legst di nieda!', 'Mia san mia!'],
      ton: ['Sauber!', 'Des basst scho.', 'Oiwei weida so!'],
      low: ['Ja mei, des war nix.', 'Host z vui Weißbier ghabt?', 'Geh weida, des ko mei Oma aa.'],
      zero: ['Ja Herrschaftszeiten!', 'Do waar a Weißwurscht treffsicherer.'],
      bust: ['Z vui is z vui.', 'Herrgottsakrament!'],
      game: ['Prost Mahlzeit!', 'Jetzt a Hoibe drauf!'],
    },
  },
  saechs: {
    label: 'Sächsisch', rate: 0.95,
    triple: 'Dribbl', double: 'Dobbl', bull: 'Bullsaai', outerBull: 'fümfunzwanzsch', miss: 'Daneebn',
    bust: 'Nu, übergeworfn', noScore: 'Nüschd', game: 'Gähm schott, nu glar',
    youRequire: (n) => `Nu brauchste noch ${n}`, cameraLost: 'Ei verbibbsch, de Gamera siehd nüschd mehr', next: (name) => `${name}, nu mach ma`,
    test: 'Dribbl zwanzsch. Hundertachtzsch, nu glar!',
    quips: {
      s180: ['Ei verbibbsch, hundertachtzsch!', 'Nu da gugge ma!', 'Das gibbs doch nüschd!'],
      ton: ['Nu glar!', 'Das war jetz nich schlescht.', 'Bombsch!'],
      low: ['Ach Gottchen.', 'Nu, das war nüschd.', 'Da hätt isch mehr geworfn.'],
      zero: ['Nüschd, gar nüschd.', 'Ei Gottchen, ei Gottchen.'],
      bust: ['Das war ä bissl zu viel, nu.'],
      game: ['Nu, ä Schälchen Heeßen druff!', 'Glasse!'],
    },
  },
  koelsch: {
    label: 'Kölsch',
    triple: 'Tripple', double: 'Dubbel', miss: 'Donevve', bust: 'Övverworfe', noScore: 'Nix, jaanix',
    youRequire: (n) => `Noch ${n}`, cameraLost: 'Hölp, de Kamera sieht nix mieh', next: (name) => `${name}, jetz bes du dran`,
    test: 'Tripple zwanzich. Hundertachzich, Kölle Alaaf!',
    quips: {
      s180: ['Leck mich en de Täsch, hundertachzich!', 'Kölle Alaaf!', 'Dat es Karneval!'],
      ton: ['Joot jemaht!', 'Et hätt noch immer joot jejange.'],
      low: ['Et kütt wie et kütt.', 'Jede Jeck es anders.', 'Do laachste disch kapott.'],
      zero: ['Wat fott es, es fott.', 'Nix, ävver och jaanix.'],
      bust: ['Dat wor jet ze vill.'],
      game: ['Drink doch ene met!', 'Jetz e Kölsch!'],
    },
  },
  berlin: {
    label: 'Berlinerisch', rate: 1.05,
    miss: 'Daneben, wa', bust: 'Überworfen, wa', noScore: 'Nüscht',
    youRequire: (n) => `Brauchste noch ${n}, wa`, cameraLost: 'Ey, die Kamera sieht nüscht mehr', next: (name) => `${name}, ran an den Speck`,
    test: 'Triple zwanzich. Hundertachtzich, ick gloob et nich!',
    quips: {
      s180: ['Ick gloob, mir tritt n Pferd! Hundertachtzich!', 'Dit is ja dufte!', 'Da kiekste, wa?'],
      ton: ['Jut jemacht, Keule.', 'Dit kann sich sehn lassen.'],
      low: ['Na, dit war wohl nüscht.', 'Mach ma halblang, Meister.'],
      zero: ['Nüscht. Jar nüscht.', 'Dit tut ja beim Hinkieken weh.'],
      bust: ['Dit war n bisschen zu ville.'],
      game: ['Icke freu mir!', 'Dit is Berlin, Baby!'],
    },
  },
  schwaeb: {
    label: 'Schwäbisch', rate: 0.95,
    triple: 'Dribbl', double: 'Dobbl', miss: 'Danäba', bust: 'Iberworfa', noScore: 'Nix, gar nix',
    youRequire: (n) => `Brauchsch no ${n}`, cameraLost: 'Hano, d Kamera sieht nix meh', next: (name) => `${name}, jetzt bisch du dra`,
    test: 'Dribbl zwanzg. Hundertachtzg, heidanei!',
    quips: {
      s180: ['Heidanei, hundertachtzg!', 'Des isch jo dr Hammer!', 'Nix gschwätzt isch globt gnug, aber des isch subber!'],
      ton: ['Passt scho.', 'Ned schlecht, Herr Specht.'],
      low: ['Schaffe, schaffe, Häusle baue, aber des war nix.', 'Oh je, des koscht Nerva.'],
      zero: ['Do hätt mr au s Geld spara kenna.', 'Hano, des isch nix.'],
      bust: ['Z viel isch z viel.'],
      game: ['Jetzt gibts a Viertele!', 'Des hosch guat gmacht!'],
    },
  },
  pott: {
    label: 'Ruhrpott', rate: 1.05,
    miss: 'Danebn, Hömma', bust: 'Überworfen, Kumpel', noScore: 'Nix, Hömma',
    youRequire: (n) => `Brauchse noch ${n}`, cameraLost: 'Hömma, die Kamera sieht nix mehr', next: (name) => `${name}, mach hinne`,
    test: 'Triple zwanzich. Hundertachtzich, Glück auf!',
    quips: {
      s180: ['Hömma, hundertachtzich! Dat gibbet doch nich!', 'Glück auf, Kumpel!', 'Boah ey!'],
      ton: ['Dat is ne Hausnummer.', 'Ich sach ma, läuft.'],
      low: ['Da kannze nix machen.', 'Woanders is auch nich schöner.'],
      zero: ['Dat war nix, Kumpel.', 'Mach ma Pause, geh ma ne Currywurst holn.'],
      bust: ['Dat war ne Schippe zu viel.'],
      game: ['Pommes Schranke für alle!', 'Dat isset!'],
    },
  },
  wien: {
    label: 'Wienerisch', rate: 0.95, voicePrefer: /de-AT/i,
    double: 'Doppl', miss: 'Danebn, oida', bust: 'Überworfn', noScore: 'Nix, gor nix',
    youRequire: (n) => `Brauchst no ${n}`, cameraLost: 'Oida, de Kamera siacht nix mehr', next: (name) => `${name}, jetzt bist du dran, Burli`,
    test: 'Triple zwanzig. Hundertachtzig, oida!',
    quips: {
      s180: ['Oida, hundertachtzig! A Wahnsinn!', 'Leiwand!', 'Na servas!'],
      ton: ['Ur leiwand.', 'Passt eh.'],
      low: ['Geh bitte.', 'Des is jetzt a Schmäh, oder?'],
      zero: ['Na, des woar nix.', 'Heast, wos is denn mit dir los?'],
      bust: ['Na, des woar z vü.'],
      game: ['Jetzt a Melange!', 'Bussi baba!'],
    },
  },
  schweiz: {
    label: 'Schwiizerdütsch', rate: 0.9, voicePrefer: /de-CH/i,
    double: 'Dopplet', miss: 'Danäbe', bust: 'Überworfe', noScore: 'Nüt', game: 'Game shot, merci vielmal',
    youRequire: (n) => `Chasch no ${n}`, cameraLost: 'Hoppla, d Kamera gseht nüt meh', next: (name) => `${name}, du bisch dra`,
    test: 'Triple zwänzg. Hundertachtzg, hoppla!',
    quips: {
      s180: ['Hoppla, hundertachtzg!', 'Das isch de Hammer, gäll!', 'Uhuere guet!'],
      ton: ['Super gmacht.', 'Läuft bi dir.'],
      low: ['Oh nei, das isch nüt gsi.', 'Gmüetlich, gmüetlich.'],
      zero: ['Nüt, gar nüt.', 'Da gits nüt z lache.'],
      bust: ['Es bitzeli z vill.'],
      game: ['Jetzt gits es Fondue!', 'Merci, das isch schön gsi.'],
    },
  },
  platt: {
    label: 'Hamburger Platt', rate: 0.95,
    miss: 'Vörbi', bust: 'Överworpen', noScore: 'Nix, min Jung',
    youRequire: (n) => `Noch ${n}, min Jung`, cameraLost: 'Mensch, de Kamera süht nix mehr', next: (name) => `${name}, nu du`,
    test: 'Triple twintig. Hundertachtzig, moin moin!',
    quips: {
      s180: ['Moin moin, hundertachtzig!', 'Dor kiekst du, wat?', 'Allens klor!'],
      ton: ['Löppt.', 'Nich schlecht, Herr Specht.'],
      low: ['Nu man nich hudeln.', 'Dat weer nix.'],
      zero: ['Nix, min Jung. Gor nix.', 'Dor is ja de Möwe treffsicherer.'],
      bust: ['Een beten to veel.'],
      game: ['Dor gifft dat en Lütten up!', 'Tschüss, mit ü!'],
    },
  },
  reporter: {
    label: 'Sportreporter', rate: 1.15, pitch: 1.15,
    bust: 'Überworfen! Was für ein Drama!', noScore: 'Null Punkte! Das darf nicht wahr sein!', game: 'Game shot! Unfassbar',
    next: (name) => `Und jetzt: ${name}!`,
    test: 'Triple zwanzig! Einhundertachtzig! Das Publikum tobt!',
    quips: {
      s180: ['Einhundertachtzig! Das Publikum tobt!', 'Ich hab Gänsehaut, meine Damen und Herren!', 'Maximum! Die Halle steht kopf!'],
      ton: ['Starke Aufnahme!', 'Da ist der Druck auf dem Gegner!', 'Weltklasse, einfach Weltklasse!'],
      low: ['Da ist er nicht richtig reingekommen.', 'Das hat er sich anders vorgestellt.'],
      zero: ['Das tut weh. Das tut richtig weh.', 'Ich kann gar nicht hinsehen!'],
      bust: ['Die Nerven! Die Nerven!'],
      game: ['Das ist Geschichte, meine Damen und Herren!', 'Was für ein Finish!'],
    },
  },
};

// Deutsch mit Akzent: deutscher Text, gesprochen von einer ausländischen iPhone-Stimme.
// Das ergibt den Akzent – und es sind Männerstimmen, die iOS jeder Web-App mitgibt
// (Xander, Thomas, Luca, Jorge, Daniel). Fehlt die Stimme, nimmt iOS eine andere derselben Sprache.
const ACCENTS = {
  holland: {
    label: 'Holländer', voiceLang: 'nl', bcp: 'nl-NL', voicePrefer: /xander/i,
    youRequire: (n) => `Nog ${n}, hè`, next: (name) => `${name}, jij bent dran`, cameraLost: 'Hè, die Kamera sieht nix mehr',
    test: 'Triple zwanzig. Hundertachtzig, lekker hè!',
    quips: {
      s180: ['Hundertachtzig! Lekker, hè!', 'Hup Holland hup!', 'Dat is fantastisch!'],
      ton: ['Lekker!', 'Sehr gut, hè!'],
      low: ['Ach, so jammer.', 'Das war nix, hè.'],
      zero: ['Nul punten, hè.', 'Helemaal niks.'],
      bust: ['Jammer, jammer.'],
      game: ['Proost! Jetzt Pommes mit Mayo!', 'Gefeliciteerd!'],
    },
  },
  franzose: {
    label: 'Franzose', voiceLang: 'fr', bcp: 'fr-FR', voicePrefer: /thomas/i,
    youRequire: (n) => `Noch ${n}, mon ami`, next: (name) => `${name}, à toi`, cameraLost: 'Oh là là, die Kamera sieht nichts mehr',
    test: 'Triple zwanzig. Hundertachtzig, magnifique!',
    quips: {
      s180: ['Hundertachtzig! Magnifique!', 'Oh là là, formidable!', 'Incroyable!'],
      ton: ['Très bien!', 'Formidable!'],
      low: ['Oh là là, catastrophe.', 'Mon dieu, das war nix.'],
      zero: ['Rien de rien.', 'Zéro. Quel dommage.'],
      bust: ['Quel dommage!'],
      game: ['Champagner für alle! Santé!', 'Bravo, bravo!'],
    },
  },
  italiener: {
    label: 'Italiener', voiceLang: 'it', bcp: 'it-IT', voicePrefer: /luca/i,
    youRequire: (n) => `Noch ${n}, amico`, next: (name) => `${name}, avanti`, cameraLost: 'Mamma mia, die Kamera sieht nix mehr',
    test: 'Triple zwanzig. Hundertachtzig, mamma mia!',
    quips: {
      s180: ['Hundertachtzig! Mamma mia!', 'Che bello! Perfetto!', 'Bellissimo!'],
      ton: ['Bravissimo!', 'Molto bene!'],
      low: ['Mamma mia, was war das?', 'Ma dai!'],
      zero: ['Niente, niente.', 'Zero. Che peccato.'],
      bust: ['Mannaggia!'],
      game: ['Espresso für alle! Grazie!', 'Campione!'],
    },
  },
  spanier: {
    label: 'Spanier', voiceLang: 'es', bcp: 'es-ES', voicePrefer: /jorge|juan|diego/i,
    youRequire: (n) => `Noch ${n}, amigo`, next: (name) => `${name}, vamos`, cameraLost: 'Ay caramba, die Kamera sieht nichts mehr',
    test: 'Triple zwanzig. Hundertachtzig, olé!',
    quips: {
      s180: ['Hundertachtzig! Olé!', 'Ay caramba, qué bueno!', 'Fantástico!'],
      ton: ['Muy bien!', 'Qué bonito!'],
      low: ['Ay, ay, ay.', 'Madre mía.'],
      zero: ['Nada de nada.'],
      bust: ['Qué pena!'],
      game: ['Fiesta! Sangria für alle!', 'Campeón!'],
    },
  },
  englaender: {
    label: 'Engländer', voiceLang: 'en', bcp: 'en-GB', voicePrefer: /daniel|arthur|oliver/i,
    youRequire: (n) => `Noch ${n}, my friend`, next: (name) => `${name}, your turn, bitte`, cameraLost: 'Oh dear, die Kamera sieht nichts mehr',
    test: 'Triple zwanzig. Hundertachtzig, lovely!',
    quips: {
      s180: ['Hundertachtzig! Lovely!', 'Brilliant, absolutely brilliant!', 'Jolly good show!'],
      ton: ['Very nice, sehr gut!', 'Splendid!'],
      low: ['Oh dear, oh dear.', 'Not cricket, that.'],
      zero: ['Nothing at all. Schade.'],
      bust: ['Bloody hell!'],
      game: ['Tea time! Prost!', 'Cheers, mate!'],
    },
  },
};

const EN = {
  label: 'Englisch', voiceLang: 'en',
  triple: 'Treble', double: 'Double', bull: 'Bullseye', outerBull: 'twenty five', miss: 'Miss',
  bust: 'Bust', noScore: 'No score', rest: 'You require', game: 'Game shot', leg: 'and the leg', set: 'and the set', match: 'and the match',
  youRequire: (n) => `${n} left`, cameraLost: 'Warning, camera lost the board', next: (name) => `${name} to throw`,
  test: 'Treble twenty. One hundred and eighty.',
  // Cricket und Training
  marks: (n) => (n === 1 ? 'One mark' : `${n} marks`), hits: (n) => (n === 1 ? 'One hit' : `${n} hits`),
  target: (x) => `Next, ${x}`, darts: (n) => `${n} darts`, points: (n) => `${n} points`,
  trainingDone: 'Practice complete', failed: 'Missed it', out: 'Game over', shanghai: 'Shanghai!',
};

// Englischer Slang (Sprüche wie bei den Dialekten, passende Stimme wenn vorhanden)
const EN_SLANG = {
  caller: {
    label: 'TV-Caller', rate: 0.9, pitch: 0.9, voicePrefer: /daniel|arthur/i,
    test: 'Treble twenty. One hundred and eightyyy!',
    quips: {
      s180: ['One hundred and eightyyy! The crowd goes wild!', 'What a maximum!', 'Get in there!'],
      ton: ['Lovely darts.', 'Big score, that.', 'Ton plus!'],
      low: ['Not the start he wanted.', 'Under pressure now.'],
      zero: ['Nothing doing there.', 'Wires everywhere!'],
      bust: ['Too many! Back to the oche.'],
      game: ['What a finish!', 'He has done it!'],
    },
  },
  cockney: {
    label: 'Cockney', voicePrefer: /daniel|arthur/i,
    bust: 'Bust, innit', noScore: 'Nuffin', miss: 'Missed it, mate',
    youRequire: (n) => `${n} left, guv`, next: (name) => `${name}, you're up, mate`, cameraLost: "Oi! The camera's lost the board",
    test: 'Treble twenty. One hundred and eighty, innit!',
    quips: {
      s180: ['Blimey! One hundred and eighty, innit!', 'Cor, what a cracker!', 'Lovely jubbly!'],
      ton: ['Proper job, mate.', 'Not bad, guv.'],
      low: ["Bit of a pig's ear, that.", 'Gordon Bennett!'],
      zero: ['Absolutely nuffin, mate.', 'You having a laugh?'],
      bust: ["Gone and bust it, ain't ya."],
      game: ['Get the kettle on!', 'Pie and mash for everyone!'],
    },
  },
  scottish: {
    label: 'Schottisch', voicePrefer: /fiona|scotland/i,
    miss: 'Missed it, ya numpty', noScore: 'Nothin at aw',
    youRequire: (n) => `${n} tae go`, next: (name) => `${name}, yer up`, cameraLost: "Och, the camera's lost the board",
    test: 'Treble twenty. One hundred and eighty, och aye!',
    quips: {
      s180: ["Och aye, one hundred and eighty! Pure dead brilliant!", "Away an bile yer heid, that's magic!"],
      ton: ['Braw, that.', 'No bad at aw.'],
      low: ["Ach, that's mince.", 'Whit a stramash.'],
      zero: ['Haud yer wheesht, that was nothin.'],
      bust: ["Ye've gone and bust it, ya numpty."],
      game: ['Get the whisky oot!', 'Slainte!'],
    },
  },
  aussie: {
    label: 'Australisch', bcp: 'en-AU', voicePrefer: /en-AU|lee|karen/i,
    noScore: 'Not a sausage', youRequire: (n) => `${n} to go, mate`, next: (name) => `${name}, you're up, mate`,
    cameraLost: "Crikey, the camera's lost the board",
    test: "Treble twenty. One hundred and eighty, strewth!",
    quips: {
      s180: ['Strewth! One hundred and eighty!', 'Fair dinkum, mate, what a ripper!'],
      ton: ['Good on ya, mate.', 'Bonza!'],
      low: ['Yeah nah, that was rubbish.', 'Strewth, that was ordinary.'],
      zero: ['Not a sausage, mate.'],
      bust: ['Crikey! Too many, mate.'],
      game: ['Throw another shrimp on the barbie!', 'Ripper of a finish!'],
    },
  },
  irish: {
    label: 'Irisch', bcp: 'en-IE', voicePrefer: /en-IE|moira/i,
    noScore: 'Nothin at all, so it was', youRequire: (n) => `${n} to go, so`, next: (name) => `${name}, you're up now`,
    cameraLost: "Ah no, the camera's lost the board",
    test: 'Treble twenty. One hundred and eighty, sure that is grand!',
    quips: {
      s180: ['Ah, would ya look at that, one hundred and eighty!', "Sure that's grand, that's deadly!"],
      ton: ["That's grand.", 'Fair play to ya.'],
      low: ['Ah stop, that was desperate.', 'Janey Mac.'],
      zero: ['Nothin at all, so it was.'],
      bust: ['Ah, for the love of God.'],
      game: ['Get the pints in!', "Sláinte, ya legend!"],
    },
  },
  texan: {
    label: 'Texanisch', bcp: 'en-US', voicePrefer: /fred|aaron|alex|en-US/i,
    noScore: "Ain't nothin", youRequire: (n) => `${n} to go, partner`, next: (name) => `${name}, saddle up`,
    cameraLost: "Well shoot, the camera done lost the board",
    test: 'Treble twenty. One hundred and eighty, yeehaw!',
    quips: {
      s180: ['Yeehaw! One hundred and eighty!', 'Well butter my biscuit!'],
      ton: ['Mighty fine throwin.', "That dog'll hunt."],
      low: ['Bless your heart.', 'Slower than molasses, that one.'],
      zero: ["Ain't nothin, partner."],
      bust: ['Done got too greedy, partner.'],
      game: ["Drinks on the house, y'all!", 'Yeehaw!'],
    },
  },
  pirate: {
    label: 'Pirat', pitch: 0.8, rate: 0.9, voicePrefer: /daniel|arthur/i,
    bust: 'Bust, arrr', noScore: 'Not a doubloon', miss: 'Missed, ye landlubber',
    youRequire: (n) => `${n} doubloons to go`, next: (name) => `${name}, man the cannons`, cameraLost: 'Arrr, the spyglass has lost the board',
    test: 'Treble twenty. One hundred and eighty, arrr!',
    quips: {
      s180: ['Arrr! One hundred and eighty, shiver me timbers!', 'Yo ho ho, a treasure of a throw!'],
      ton: ['Arr, fine shootin, matey.'],
      low: ['Walk the plank for that one!', 'Ye scurvy dog.'],
      zero: ['Not a single doubloon!'],
      bust: ["Into Davy Jones' locker with ye!"],
      game: ['Break out the rum, me hearties!'],
    },
  },
};

const GROUP_DE = 'Deutsch & Dialekte', GROUP_ACCENT = 'Deutsch mit Akzent (Männerstimmen)', GROUP_EN = 'Englisch & Slang';
const withGroup = (obj, base, group) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { ...base, ...v, group }]));
const TEXT = {
  de: { ...DE, group: GROUP_DE },
  ...withGroup(DIALECTS, DE, GROUP_DE),
  ...withGroup(ACCENTS, DE, GROUP_ACCENT),
  en: { ...EN, group: GROUP_EN },
  ...withGroup(EN_SLANG, EN, GROUP_EN),
};

/** Auswahl für die Einstellungen: [Schlüssel, Name, Gruppe]. */
export const SPEECH_LANGS = Object.entries(TEXT).map(([k, v]) => [k, v.label, v.group]);

function lang() {
  const l = getSettings().speechLang;
  return TEXT[l] ? l : 'de';
}
export function t() {
  return TEXT[lang()];
}
/** Sprache der Stimmen ('de' oder 'en') zu einer Ansage-Sprache. */
export function voiceLangOf(l = lang()) {
  return (TEXT[l] || DE).voiceLang;
}

/** Zufälliger Spruch zum Anlass (oder null, wenn aus/keiner vorhanden). */
function quip(kind) {
  const list = getSettings().quips !== false && t().quips && t().quips[kind];
  return list && list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

export function speechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

let voicesCache = [];
function loadVoices() {
  if (!speechSupported()) return [];
  voicesCache = window.speechSynthesis.getVoices() || [];
  return voicesCache;
}
if (speechSupported()) {
  loadVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

export function availableVoices(forLang = voiceLangOf()) {
  const all = voicesCache.length ? voicesCache : loadVoices();
  return all.filter((v) => v.lang && v.lang.toLowerCase().startsWith(forLang));
}

function pickVoice() {
  const s = getSettings();
  const list = availableVoices();
  if (s.voiceURI) {
    const v = list.find((x) => x.voiceURI === s.voiceURI);
    if (v) return v;
  }
  // Dialekt mit eigener Stimme (z. B. österreichisch), sonst „erweiterte/Premium“-Qualität,
  // sonst die Standardstimme der Sprache
  const pref = t().voicePrefer;
  const preferred = (pref && list.find((v) => pref.test(v.lang) || pref.test(v.name)))
    || list.find((v) => /premium|enhanced|erweitert/i.test(v.name)) || list.find((v) => v.default) || list[0];
  return preferred || null;
}

let unlocked = false;
/** Muss aus einem Tipp-Ereignis heraus aufgerufen werden (iOS). */
export function unlock() {
  if (speechSupported() && !unlocked) {
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
      unlocked = true;
    } catch { /* ignorieren */ }
  }
  unlockAudio();
}

export function say(text, { interrupt = false } = {}) {
  if (!speechSupported() || !text) return;
  const synth = window.speechSynthesis;
  if (interrupt) synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  const T = t();
  u.lang = v ? v.lang : (T.bcp || (T.voiceLang === 'en' ? 'en-GB' : 'de-DE'));
  u.rate = Math.min(2, (getSettings().speechRate || 1) * (T.rate || 1));
  u.pitch = Math.min(2, Math.max(0.1, (T.pitch || 1) * (getSettings().speechPitch ?? 1)));
  // iOS bleibt manchmal im Pausenzustand hängen
  if (synth.paused) synth.resume();
  synth.speak(u);
  return u;
}

export function dartText(hit) {
  const T = t();
  if (!hit || hit.multiplier === 0 || hit.segment === 0) return T.miss;
  if (hit.segment === 25) return hit.multiplier === 2 ? T.bull : T.outerBull;
  if (hit.multiplier === 3) return `${T.triple} ${hit.segment}`;
  if (hit.multiplier === 2) return `${T.double} ${hit.segment}`;
  return String(hit.segment);
}

export function announceDart(hit) {
  // Ein neuer Dart überholt eine noch ausstehende Rest-Ansage
  restGen++;
  clearTimeout(restTimer);
  if (getSettings().announceDart) say(dartText(hit));
}

/** Summe der Aufnahme (und ggf. Rest) ansagen. */
export function announceTurn({ points, bust, finished, remaining, legWon, setWon, matchWon }) {
  const s = getSettings();
  const T = t();
  const parts = [];
  if (finished) {
    parts.push(T.game);
    if (matchWon) parts.push(T.match);
    else if (setWon) parts.push(T.set);
    else if (legWon) parts.push(T.leg);
    parts.push(quip('game'));
  } else if (s.announceTurn) {
    parts.push(bust ? T.bust : points === 0 ? T.noScore : String(points));
    // Sprüche: bei 180, Überwerfen und 0 immer, sonst nur ab und zu (sonst nervt es)
    if (bust) parts.push(quip('bust'));
    else if (points === 180) parts.push(quip('s180'));
    else if (points === 0) parts.push(quip('zero'));
    else if (points >= 100 && Math.random() < 0.5) parts.push(quip('ton'));
    else if (points <= 20 && Math.random() < 0.5) parts.push(quip('low'));
  }
  const restText = !finished && s.announceRest && remaining > 0 ? T.youRequire(remaining) : null;
  speakWithRest(parts, restText);
}

/** Eigene Ansage eines Spielmodus (Cricket, Training): parts sofort, rest nach der Pause. */
export function announceParts({ parts = [], rest = null } = {}) {
  const s = getSettings();
  speakWithRest(s.announceTurn ? parts : [], s.announceRest ? rest : null);
}

/** Texte des aktuellen Dialekts plus Dart-Text, für Ansagen der Spielmodi. */
export function speechHelpers() {
  return { T: t(), hit: dartText };
}

function speakWithRest(parts, restText) {
  const s = getSettings();
  parts = parts.filter(Boolean);
  clearTimeout(restTimer);
  const gen = ++restGen; // ältere, noch ausstehende Rest-Ansagen verfallen
  if (!parts.length) { if (restText) say(restText); return; }
  const u = say(parts.join('. '));
  if (!restText) return;
  // Rest erst nach einer Pause ansagen (einstellbar), damit Summe und Rest nicht ineinander laufen
  const pauseMs = Math.round((s.restPause ?? 1) * 1000);
  let done = false;
  const sayRest = () => { if (done || gen !== restGen) return; done = true; restTimer = setTimeout(() => { if (gen === restGen) say(restText); }, pauseMs); };
  if (u) {
    u.addEventListener('end', sayRest);
    u.addEventListener('error', sayRest);
  }
  // Sicherheitsnetz: iOS meldet „end“ nicht immer zuverlässig
  restTimer = setTimeout(sayRest, 2500 + pauseMs);
}
let restTimer = null;
let restGen = 0;

// ---------- Töne ----------
let audioCtx = null;
function unlockAudio() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* ignorieren */ }
}

export function beep(kind = 'warn') {
  if (!getSettings().beeps || !audioCtx) return;
  const now = audioCtx.currentTime;
  const seq = kind === 'warn' ? [[880, 0], [660, 0.18], [880, 0.36]] : [[1200, 0]];
  for (const [f, at] of seq) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = f;
    o.type = 'square';
    g.gain.setValueAtTime(0.0001, now + at);
    g.gain.exponentialRampToValueAtTime(0.25, now + at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.15);
    o.connect(g).connect(audioCtx.destination);
    o.start(now + at);
    o.stop(now + at + 0.16);
  }
}

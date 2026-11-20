// UI strings. Add a language by adding a block with the same keys.

type Strings = {
  yourName: string;
  join: string;
  typeAnything: string;
  typeLabel: string;
  rules: string;
  copyInvite: string;
  linkCopied: string;
  theme: { auto: string; light: string; dark: string };
  changeName: (name: string) => string;
  backspaces: (n: number, plural: Intl.LDMLPluralRule) => string;
  people: string;
  joined: (name: string) => string;
  left: (name: string) => string;
  said: (names: string, text: string) => string;
  someone: string;
  connected: string;
  reconnecting: string;
};

const en: Strings = {
  yourName: "your name",
  join: "Join",
  typeAnything: "type anything",
  typeLabel: "Type into the shared bubble",
  rules:
    "Everyone in this room types into one bubble at the same time, and everyone sees it as you type. " +
    "Each letter you send earns one backspace, and a backspace crosses out the newest letter, whoever typed it. " +
    "After 5 seconds of quiet the bubble locks and the next keystroke starts a new one. Nothing is saved.",
  copyInvite: "Copy invite link",
  linkCopied: "link copied",
  theme: { auto: "Theme: match system", light: "Theme: light", dark: "Theme: dark" },
  changeName: (name) => `${name} (you). Change your name`,
  backspaces: (n, p) => `${n} ${p === "one" ? "backspace" : "backspaces"}`,
  people: "People here",
  joined: (name) => `${name} joined`,
  left: (name) => `${name} left`,
  said: (names, text) => `${names}: ${text}`,
  someone: "someone",
  connected: "Connected",
  reconnecting: "Connection lost, reconnecting",
};

const es: Strings = {
  yourName: "tu nombre",
  join: "Entrar",
  typeAnything: "escribe lo que sea",
  typeLabel: "Escribe en la burbuja compartida",
  rules:
    "Todos en esta sala escriben en una sola burbuja al mismo tiempo, y todos lo ven mientras escribes. " +
    "Cada letra que envías te da un borrado, y un borrado tacha la letra más reciente, sea de quien sea. " +
    "Tras 5 segundos de silencio la burbuja se bloquea y la siguiente tecla empieza una nueva. No se guarda nada.",
  copyInvite: "Copiar enlace de invitación",
  linkCopied: "enlace copiado",
  theme: { auto: "Tema: como el sistema", light: "Tema: claro", dark: "Tema: oscuro" },
  changeName: (name) => `${name} (tú). Cambiar tu nombre`,
  backspaces: (n, p) => `${n} ${p === "one" ? "borrado" : "borrados"}`,
  people: "Personas aquí",
  joined: (name) => `${name} entró`,
  left: (name) => `${name} salió`,
  said: (names, text) => `${names}: ${text}`,
  someone: "alguien",
  connected: "Conectado",
  reconnecting: "Se perdió la conexión, reconectando",
};

const ALL: Record<string, Strings> = { en, es };

function pickLang(): string {
  const wanted = new URLSearchParams(location.search).get("lang");
  const prefs = [wanted, ...(navigator.languages ?? [navigator.language])].filter(Boolean) as string[];
  for (const p of prefs) {
    const base = p.toLowerCase().split("-")[0];
    if (ALL[base]) return base;
  }
  return "en";
}

export const lang = pickLang();
export const t = ALL[lang];

const plural = new Intl.PluralRules(lang);
const list = "ListFormat" in Intl ? new Intl.ListFormat(lang, { style: "long", type: "conjunction" }) : null;
export const pluralOf = (n: number) => plural.select(n);
export const joinNames = (names: string[]) => (list ? list.format(names) : names.join(", "));

// Ícone e cor de cada área das palestras. Usado pelo passaporte e pela página da palestra (palestra.html).
// Área nova cai no padrão (estrela roxa).
const badgeThemes = [
  [/carreira|experi/i, "🚀", "orange"], [/dado/i, "📊", "cyan"], [/intelig|\bia\b|\bai\b/i, "🤖", "purple"],
  [/pesquisa|ci[eê]ncia/i, "🔬", "teal"], [/nuvem|cloud/i, "☁️", "blue"], [/rob[oó]/i, "🦾", "pink"],
  [/empreend|startup/i, "💡", "yellow"], [/engenharia|software/i, "🛠️", "green"], [/seguran/i, "🛡️", "red"],
  [/jogo|game/i, "🎮", "magenta"]
];
function badgeTheme(category) {
  const found = badgeThemes.find(([pattern]) => pattern.test(category ?? ""));
  return { icon: found?.[1] ?? "⭐", tone: found?.[2] ?? "purple" };
}
// Medalha da área em tamanho pequeno (lista de selos do perfil, FAQ e avaliação).
function miniEmblem(category) {
  const theme = badgeTheme(category);
  const icon = document.createElement("span"); icon.className = `badge-icon mini-emblem tone-${theme.tone}`;
  icon.textContent = theme.icon; icon.setAttribute("aria-hidden", "true");
  return icon;
}

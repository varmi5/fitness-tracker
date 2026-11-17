export function foodEmoji(name: string, category?: string): string {
  const text = name.toLowerCase();
  if (/coffee|espresso|cappuccino|latte/.test(text)) return "☕";
  if (/tea|matcha/.test(text)) return "🍵";
  if (/water/.test(text)) return "💧";
  if (/milk|shake|smoothie|protein drink/.test(text)) return "🥛";
  if (/juice|soda|cola|lemonade|drink/.test(text)) return "🥤";
  if (/beer/.test(text)) return "🍺";
  if (/wine/.test(text)) return "🍷";
  if (/egg|omelette/.test(text)) return "🥚";
  if (/chicken|turkey/.test(text)) return "🍗";
  if (/lamb|beef|steak|pork/.test(text)) return "🥩";
  if (/salmon|tuna|fish|prawn/.test(text)) return "🐟";
  if (/dhal|dal|lentil|curry/.test(text)) return "🍛";
  if (/rice/.test(text)) return "🍚";
  if (/bread|toast|sandwich/.test(text)) return "🍞";
  if (/oat|porridge|cereal/.test(text)) return "🥣";
  if (/banana/.test(text)) return "🍌";
  if (/apple/.test(text)) return "🍎";
  if (/berr|grape/.test(text)) return "🫐";
  if (/salad|vegetable|broccoli/.test(text)) return "🥗";
  if (/pizza/.test(text)) return "🍕";
  if (/pasta|noodle/.test(text)) return "🍝";
  if (/cheese/.test(text)) return "🧀";
  if (/chocolate|cocoa/.test(text)) return "🍫";
  if (/nut|almond|peanut/.test(text)) return "🥜";
  return category === "drinks" ? "🥤" : "🍽️";
}

// Quick parser test: simulates fetchQuotes on a saved HTML page
const html = require("fs").readFileSync(process.argv[2] || "quotes.html", "utf8");

function parse(html) {
  const blocks = [...html.matchAll(
    /<dt class="quote">\s*<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<dd class="author">([\s\S]*?)<\/dd>/g
  )];

  return blocks.map(([, text, authorBlock]) => {
    const authorMatch = authorBlock.match(/<b>([\s\S]*?)<\/b>/);
    const authorRaw = authorMatch
      ? authorMatch[1].replace(/<a[^>]*>/g, "").replace(/<\/a>/g, "")
      : "";
    const yearsRe = /\((\d{3,4}\s*(?:BC)?)\s*-\s*(\d{3,4}\s*(?:BC)?)?\s*\)/i;
    const yearsMatch = authorRaw.match(yearsRe);
    const years = yearsMatch ? `(${yearsMatch[1]} - ${yearsMatch[2] ?? ""})` : null;

    const sourceMatch = authorBlock.match(/<\/b>,?\s*<i>([\s\S]*?)<\/i>/);
    const sourceRaw = sourceMatch ? sourceMatch[1].replace(/<[^>]*>/g, "").trim() : "";
    const isDateOnly = /^[(\d)\s\-–—,\.]+$/.test(sourceRaw);
    const source = sourceRaw && !isDateOnly ? sourceRaw : null;

    const author = (authorRaw || "Unknown")
      .replace(new RegExp(yearsRe.source, "gi"), "")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim() || "Unknown";

    return {
      text: text
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
      author,
      source,
      years,
    };
  });
}

console.log(JSON.stringify(parse(html), null, 2));

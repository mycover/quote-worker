export default {
  // === Handler dla żądań HTTP — czyta cytat z cache'a (KV), round-robin ===
  async fetch(request, env, ctx) {
    // Ręczne wywołanie refresha cache'a: GET /__cron/refresh
    const url = new URL(request.url);
    if (url.pathname === "/__cron/refresh") {
      await refreshQuotes(env);
      const fresh = await env.QUOTE_CACHE.get("quotes", { type: "json" });
      return new Response(JSON.stringify({ refreshed: true, count: fresh?.quotes?.length ?? 0 }, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const cached = await env.QUOTE_CACHE.get("quotes", { type: "json" });

    if (!cached || !cached.quotes?.length) {
      // Cache pusty (cron jeszcze nie zadziałał) — pusta lista
      return new Response(JSON.stringify([]), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // Round-robin: bierz kolejny cytat z listy, licznik trzymamy w tym samym wpisie KV
    const idx = (cached.rr ?? 0) % cached.quotes.length;
    ctx.waitUntil(
      env.QUOTE_CACHE.put(
        "quotes",
        JSON.stringify({ quotes: cached.quotes, rr: idx + 1 }),
        { expirationTtl: 7200 }
      ).catch(() => {}) // limit 1 zapisu/s na klucz — w razie throttlingu po prostu pomiń
    );

    return new Response(JSON.stringify(cached.quotes[idx], null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  },

  // === Handler cron — pobiera cytaty i ładuje je do KV ===
  async scheduled(controller, env, ctx) {
    try {
      await refreshQuotes(env);
    } catch (err) {
      console.error("Błąd w scheduled:", err.message);
    }
  },
};

// Wspólna logika: pobierz świeże cytaty i nadpisz wpis w KV
async function refreshQuotes(env) {
  const quotes = await fetchQuotes();
  if (quotes.length) {
    // Zapisz z TTL — KV automatycznie wygaśnie po 2 godzinach; licznik round-robin od zera
    await env.QUOTE_CACHE.put("quotes", JSON.stringify({ quotes }), {
      expirationTtl: 7200,
    });
    console.log(`Zapisano ${quotes.length} cytatów do KV`);
  } else {
    console.log("Nie znaleziono cytatów — KV pozostaje bez zmian");
  }
}

async function fetchQuotes() {
  const response = await fetch("https://www.quotationspage.com/random.php", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();

  // Każdy cytat = blok <dt class="quote">...</dt> + następujący po nim <dd class="author">...</dd>
  const blocks = [...html.matchAll(
    /<dt class="quote">\s*<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<dd class="author">([\s\S]*?)<\/dd>/g
  )];

  return blocks.map(([, text, authorBlock]) => {
    // Autor: nazwa w <b> — może być w linku lub nie, ewentualnie z latami życia
    const authorMatch = authorBlock.match(/<b>([\s\S]*?)<\/b>/);
    const authorRaw = authorMatch
      ? authorMatch[1].replace(/<a[^>]*>/g, "").replace(/<\/a>/g, "")
      : "";
    // Lata życia: "(1859 - 1930)" lub "(234 BC - 149 BC)" — zaraz po nazwisku w <b>
    const yearsRe = /\((\d{3,4}\s*(?:BC)?)\s*-\s*(\d{3,4}\s*(?:BC)?)?\s*\)/i;
    const yearsMatch = authorRaw.match(yearsRe);
    const years = yearsMatch
      ? `(${yearsMatch[1]} - ${yearsMatch[2] ?? ""})`.replace(/\s+/g, " ").trim()
      : null;

    // Źródło: kursywa <i> po </b>, bez nawiasów (→ no to rok/okres, nie źródło)
    const sourceMatch = authorBlock.match(/<\/b>,?\s*<i>([\s\S]*?)<\/i>/);
    const sourceRaw = sourceMatch ? sourceMatch[1].replace(/<[^>]*>/g, "").trim() : "";
    // Pomijamy źródła będące wyłącznie datą, np. <i>(1910)</i>
    const isDateOnly = /^[(\d)\s\-–—,\.]+$/.test(sourceRaw);
    const source = sourceRaw && !isDateOnly ? sourceRaw : null;

    // Czysta nazwa autora: usuwamy lata i nadmiarowe białe znaki
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

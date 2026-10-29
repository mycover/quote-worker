export default {
  // === HTTP request handler — serves the next quote from the KV cache, round-robin ===
  async fetch(request, env, ctx) {
    // Manual cache refresh: GET /__cron/refresh
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
      // Cache is empty (cron hasn't run yet) — return an empty list
      return new Response(JSON.stringify([]), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // Round-robin: take the next quote, the counter lives in the same KV entry
    const idx = (cached.rr ?? 0) % cached.quotes.length;
    ctx.waitUntil(
      env.QUOTE_CACHE.put(
        "quotes",
        JSON.stringify({ quotes: cached.quotes, rr: idx + 1 }),
        { expirationTtl: 7200 }
      ).catch(() => {}) // 1 write/s per-key limit — skip the update when throttled
    );

    return new Response(JSON.stringify(cached.quotes[idx], null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  },

  // === Cron handler — fetches quotes and loads them into KV ===
  async scheduled(controller, env, ctx) {
    try {
      await refreshQuotes(env);
    } catch (err) {
      console.error("scheduled handler error:", err.message);
    }
  },
};

// Shared logic: fetch fresh quotes and overwrite the KV entry
async function refreshQuotes(env) {
  const quotes = await fetchQuotes();
  if (quotes.length) {
    // Store with TTL — KV expires the entry after 2 hours; round-robin counter resets
    await env.QUOTE_CACHE.put("quotes", JSON.stringify({ quotes }), {
      expirationTtl: 7200,
    });
    console.log(`Stored ${quotes.length} quotes in KV`);
  } else {
    console.log("No quotes found — KV left unchanged");
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

  // Each quote = a <dt class="quote">...</dt> block followed by <dd class="author">...</dd>
  const blocks = [...html.matchAll(
    /<dt class="quote">\s*<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<dd class="author">([\s\S]*?)<\/dd>/g
  )];

  return blocks.map(([, text, authorBlock]) => {
    // Author: name inside <b> — may or may not be wrapped in a link, possibly with lifespan
    const authorMatch = authorBlock.match(/<b>([\s\S]*?)<\/b>/);
    const authorRaw = authorMatch
      ? authorMatch[1].replace(/<a[^>]*>/g, "").replace(/<\/a>/g, "")
      : "";
    // Lifespan: "(1859 - 1930)" or "(234 BC - 149 BC)" — right after the name in <b>
    const yearsRe = /\((\d{3,4}\s*(?:BC)?)\s*-\s*(\d{3,4}\s*(?:BC)?)?\s*\)/i;
    const yearsMatch = authorRaw.match(yearsRe);
    const years = yearsMatch
      ? `(${yearsMatch[1]} - ${yearsMatch[2] ?? ""})`.replace(/\s+/g, " ").trim()
      : null;

    // Source: italics <i> after </b>; parentheses mean it's a date/period, not a source
    const sourceMatch = authorBlock.match(/<\/b>,?\s*<i>([\s\S]*?)<\/i>/);
    const sourceRaw = sourceMatch ? sourceMatch[1].replace(/<[^>]*>/g, "").trim() : "";
    // Skip sources that are just a date, e.g. <i>(1910)</i>
    const isDateOnly = /^[(\d)\s\-–—,\.]+$/.test(sourceRaw);
    const source = sourceRaw && !isDateOnly ? sourceRaw : null;

    // Clean author name: strip lifespan and redundant whitespace
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

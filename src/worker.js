export default {
  async fetch(request) {
    const URL = "https://www.quotationspage.com/random.php";

    try {
      const response = await fetch(URL, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });

      if (!response.ok) {
        return new Response(JSON.stringify({ error: `HTTP ${response.status}` }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }

      const html = await response.text();

      const quotes = [...html.matchAll(
        /<dt class="quote">\s*<a[^>]*>(.*?)<\/a>[\s\S]*?<dd class="author">[\s\S]*?<a[^>]*>(?!\s*<img)(.*?)<\/a>/gs
      )].map(([, text, author]) => ({
        text: text.trim(),
        author: author.trim().replace(/<[^>]*>/g, "").trim() || "Unknown",
      }));

      if (!quotes.length) {
        return new Response(JSON.stringify({ error: "Nie znaleziono cytatów." }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      const quote = quotes[Math.floor(Math.random() * quotes.length)];

      return new Response(JSON.stringify(quote, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};

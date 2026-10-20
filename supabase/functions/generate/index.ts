// Ersatt av funktionen "laxmotorn". Kvar som stängd stub så att den gamla öppna
// Claude-proxyn inte går att anropa.
Deno.serve(() =>
  new Response(JSON.stringify({ code: "gone", message: "Använd /functions/v1/laxmotorn." }), {
    status: 410,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  })
);

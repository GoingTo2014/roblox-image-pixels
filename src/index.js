export default {
  async fetch(request) {
    return new Response(
      JSON.stringify({
        message: "Roblox image pixel Worker is online!",
        method: request.method
      }),
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
};

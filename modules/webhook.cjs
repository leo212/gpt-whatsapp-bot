const whatsapp = require('./whatsapp.cjs');
const gpt = require('./gpt.cjs');

let lastHandledMessageTime = Date.now();

exports.processWebhook = (req, res) => {
    let event = req.body;

    if (event.object === "whatsapp_business_account" && event.entry) {
        event.entry.forEach(entry => {
          if (entry.changes) {
            entry.changes.forEach(change => {
              if (change.field === "messages" && change.value.messages) {
                change. value.messages.forEach(message => {
                    // only if this is a new message
                    if (message.timestamp*1000 > lastHandledMessageTime) {
                        console.log(`from: ${message.from}, message: ${message.text.body}`); 
                        whatsapp.markAsRead(message.id);
                        lastHandledMessageTime = message.timestamp*1000;

                        // get a response from the bot
                        gpt.getResponse(message.from, message.text.body).then(text => {
                             whatsapp.sendText(text, message.from);
                        })
                    }
                });
              }
            });
          }
        });
      }
}
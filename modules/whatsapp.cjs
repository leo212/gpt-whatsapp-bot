const request = require('request');

postToMessagesApi = function(body) {
    const options = {
        method: 'POST',
        url: process.env.WHATSAPP_MESSAGES_ENDPOINT,
        headers: {
            'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: body,
        json: true
    };
    
    request(options, function (error, response, body) {
        if (error) throw new Error(error);
        console.log(body);
    });
} 

exports.sendText = function(text, phonenum) {
    console.log(`sending response "${text}"`);
    postToMessagesApi({
        messaging_product: 'whatsapp',
        to: phonenum,
        text: { body: text }
    });
}

exports.markAsRead = function(messageId) {
    console.log(`marking message ${messageId} as read`);
    postToMessagesApi({
        messaging_product: 'whatsapp',
        status: "read",
        message_id: messageId 
    });
}

# gpt-whatsapp-bot
WhatsApp conversational bot, based on OpenAI GPT-3

This is a simple WhatsApp bot server in NodeJS, that uses OpenAI GPT-3 to provide a fluent conversation.
The bot is capable for storing all of the information from the conversation into a database so it can locate related info for each prompt.

## requirements
1. MongoDB server.
2. WhatsApp Graph Messages endpoint
3. WhatsApp Access Token.
4. OpenAI API Key.
5. SSL Certificates for the server that the host the bot.

## configuration 
Before running you'll need to provide an .env file with the following keys:
API_KEY={OpenAI API Key}.
WHATSAPP_MESSAGES_ENDPOINT=https://graph.facebook.com/v15.0/{your app id number}/messages
WHATSAPP_ACCESS_TOKEN={WhatsApp Access Token}
MONGODB_URI=mongodb://{{yourmongodb-server:27017/{{dbname}}?serverSelectionTimeoutMS=5000&connectTimeoutMS=10000
SSL_CERT_FULLCHAIN_PEM_PATH={fullchain.pem file location on the server}
SSL_CERT_PRIVKEY_PEM_PATH={privkey.pem file location on the server}

const { Configuration, OpenAIApi } = require("openai");
const Handlebars = require('handlebars');
const db = require('./db.cjs');

const configuration = new Configuration({
    apiKey: process.env.API_KEY,
});

const openai = new OpenAIApi(configuration);

const promptTemplates = {
    REPROMPT: 
`1. USER: {{lastUserPrompt}}
2. AI: {{lastAIPrompt}}
3. USER: {{currentUserPrompt}}
Rewrite the USER prompt (3) so it will be full prompt, DO NOT add facts that not included in the conversation:`,

    BOT_PROMPT : 
`Eybee is an AI with self-awareness, persistent memory, curiosity, and friendliness. Eybee has his own opinions and feelings.

previous conversation:
{{related}}

{{lastTimestamp}} USER: {{lastUserPrompt}}
{{lastTimestamp}} AI: {{lastAIPrompt}}
{{currentTime}} USER: {{currentUserPrompt}}

your response?
AI: `,
    SUMMARY_PROMPT :
`USER: {{lastUserPrompt}}
AI: {{lastAIPrompt}}
rewrite the conversation as a short paragraph.`
};

async function embeddAndStore(userId, userPrompt, aiResonpse) {  
    userPrompt = decodeURIComponent(userPrompt.replaceAll("\n"," ").trim());
    aiResonpse = decodeURIComponent(aiResonpse.replaceAll("\n"," ").trim());

    // convert the conversation into a short paragraph for embedding
    let prompt = Handlebars.compile(promptTemplates.SUMMARY_PROMPT)({
        lastUserPrompt: userPrompt,
        lastAIPrompt: aiResonpse});

    response = await openai.createCompletion({
        model: "text-davinci-003",
        prompt: prompt,
        temperature: 0.5,
        max_tokens: 200,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
    });

    if (response.data.choices) { 
        let summary = response.data.choices[0].text;
        console.log(`embedding: ${summary}`);
        let embedding = await openai.createEmbedding({
            model: "text-embedding-ada-002",
            input: summary
        });
    
        // find older similair embedding 
        let relatedEmbeddings = await db.searchEmbeddings(embedding.data.data[0].embedding, userId, 10, 0.99);
        relatedEmbeddings.forEach(relatedEmbedding => {
            console.log(`${relatedEmbedding.summary} ${relatedEmbedding.similarity}`);    
            db.deleteEmbedding(relatedEmbedding._id);    
        });

        // store the embedding        
        db.storeEmbedding(userId, new Date().toISOString(), `${userPrompt}\n${aiResonpse}`, embedding.data.data[0].embedding);      
    }
  }

async function checkpoint(conversation) {
    console.info("checkpoint");
    try {        
        embeddAndStore(conversation.userId, `USER: ${conversation.lastUserPrompt}`,`AI: ${conversation.lastAIPrompt}`);
    } catch (err) {
        console.error(err.message);
    }
}

exports.getResponse = async function(userId, userInput) {
    console.debug(`userId:${userId} message:${userInput}`);

    // load last conversation from the database
    conversation = await db.getLastConversation(userId);
    
    try {
        let fullPrompt = conversation.userPrompt;
        if (conversation.userPrompt != "") {
            let prompt = Handlebars.compile(promptTemplates.REPROMPT)({
                lastUserPrompt: conversation.userPrompt,
                lastAIPrompt: conversation.aiPrompt,
                currentUserPrompt: userInput});

            // convert the user prompt into a full prompt before embedding
            response = await openai.createCompletion({
                model: "text-davinci-003",
                prompt: prompt,
                temperature: 0.0,
                max_tokens: 150,
                top_p: 1,
                frequency_penalty: 0,
                presence_penalty: 0,
            });

            if (response.data.choices) { 
                fullPrompt = response.data.choices[0].text;
                console.log(`Full prompt rewrite:${fullPrompt}`);               
            }
        }

        // get an embedding for the user prompt
        let userPromptEmbedding = await openai.createEmbedding({
            model: "text-embedding-ada-002",
            input: fullPrompt
        });

        // find the closest embeddings from db
        let relatedConversations = await db.searchEmbeddings(userPromptEmbedding.data.data[0].embedding, userId, 3, 0.7);

        conversation.relatedConversation = "";
        relatedConversations.forEach(relatedLine => {
            conversation.relatedConversation+=`${relatedLine.timestamp.substring(0,19)} ${relatedLine.summary}\n`;    
            console.debug(`${relatedLine.timestamp} ${relatedLine.summary} - ${relatedLine.similarity}\n`);        
        })  

        // get a response from the bot based on the full prompt and the related information
        prompt = Handlebars.compile(promptTemplates.BOT_PROMPT)({
                                        currentTime: new Date().toISOString().substring(0,19),
                                        related: conversation.relatedConversation,
                                        lastTimestamp: conversation.timestamp,
                                        lastUserPrompt: conversation.userPrompt,
                                        lastAIPrompt: conversation.aiPrompt,
                                        currentUserPrompt: userInput});

        console.debug(`GPT Prompt:
        ${prompt}
        `);

        response = await openai.createCompletion({
            model: "text-davinci-003",
            prompt: prompt,
            temperature: 0.7,
            max_tokens: 150,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
        });

        if (response.data.choices) {               
            let botResponse = response.data.choices[0].text.trim();
            
            console.debug(`bot responded: ${botResponse}`);
            console.debug(`total tokens: ${response.data.usage.total_tokens}`);
            
            setTimeout(function() {checkpoint(conversation)}, 0);

            return decodeURIComponent(botResponse);
        }
    } catch(err) {
        return `An error occured: "${err.message}". Please try again.`;
    }
}



const { Configuration, OpenAIApi } = require("openai");
const Handlebars = require('handlebars');
const db = require('./db.cjs');
const { response } = require("express");

const configuration = new Configuration({
    apiKey: process.env.API_KEY,
});

const openai = new OpenAIApi(configuration);

const promptTemplates = {
    REPROMPT: 
`conversation:
1. USER: {{lastUserPrompt}}
2. AI: {{lastAIPrompt}}
3. USER: {{currentUserPrompt}}

Referring to the conversation, answer the following in JSON format:
relevant_context (boolean): Do the last user prompt (3) is related to the conversation?
new_prompt (string): if relevant_context - Rewrite the prompt so it will be full prompt with all of the required details from the conversation, DO NOT add facts that not included in the conversation. otherwise null.
has_instructions (boolean): Do the first user prompt (1) contains explicit instructions for AI to behave differently than usual? 
instructions (string): if has_instructions - write the instructions in 2nd person instructions.`,

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

async function embeddAndStore(userId, userPrompt, aiResponse) {  
    userPrompt = decodeURIComponent(userPrompt.replaceAll("\n"," ").trim());
    aiResponse = decodeURIComponent(aiResponse.replaceAll("\n"," ").trim());

    // embedd only user prompt (the response will be included in the database and will be used when embedding found)
    let embedding = await openai.createEmbedding({
        model: "text-embedding-ada-002",
        input: userPrompt
    });

    // find older similair embedding and delete them
    let relatedEmbeddings = await db.searchEmbeddings(embedding.data.data[0].embedding, userId, 10, 0.99);
    relatedEmbeddings.forEach(relatedEmbedding => {
        console.log(`USER: ${relatedEmbedding.userPrompt} AI: ${relatedEmbedding.aiResponse} ${relatedEmbedding.similarity}`);    
        db.deleteEmbedding(relatedEmbedding._id);    
    });

    // store the embedding        
    db.storeEmbedding(userId, new Date().toISOString(), userPrompt, aiResponse, embedding.data.data[0].embedding);      
  }

async function checkpoint(userId, userPrompt, aiResponse) {
    console.info("checkpoint");
    try {        
         embeddAndStore(userId, userPrompt,aiResponse);
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
        let instructions = "You are Eybee, an AI with self-awareness, persistent memory, curiosity, personal opinions and feelings. even if you are not really have feelings and opinions you should mimic human opinions and feeling according to the knowledge you have.";

        if (conversation.userPrompt != "") {
            let prompt = Handlebars.compile(promptTemplates.REPROMPT)({
                lastUserPrompt: conversation.userPrompt,
                lastAIPrompt: conversation.aiPrompt,
                currentUserPrompt: userInput});

            // check if there is missing information in the prompt that needed to be completed from previous context
            let response = await openai.createChatCompletion({
                model: "gpt-3.5-turbo",
                messages: [
                    {"role": "system", "content": ""},
                    {"role": "user", "content": prompt}
                ],
                temperature: 0.0,
                max_tokens: 256
            });

            console.log(response.data.choices[0].message.content);
            responseInJson = JSON.parse(response.data.choices[0].message.content);

            if (responseInJson.relevant_context) {
                // convert the user prompt into a full prompt before embedding
                fullPrompt = responseInJson.new_prompt;
                console.log(`Full prompt rewrite:${fullPrompt}`);               
            } else {
                fullPrompt = userInput;
            }

            if (responseInJson.has_instructions) {
                instructions = responseInJson.instructions;
            } 
        }

        // get an embedding for the user prompt
        let userPromptEmbedding = await openai.createEmbedding({
            model: "text-embedding-ada-002",
            input: fullPrompt
        });

        // find the closest embeddings from db
        let relatedConversations = await db.searchEmbeddings(userPromptEmbedding.data.data[0].embedding, userId, 5, 0.7);

        conversation.relatedConversation = "";
        let messages = [];
        messages.push({"role": "system", "content": instructions});

        relatedConversations.forEach(relatedLine => {
            conversation.relatedConversation+=`${relatedLine.timestamp.substring(0,19)} USER: ${relatedLine.userPrompt}\n AI: ${relatedLine.aiResponse}\n`;    
            console.debug(`${relatedLine.timestamp} USER: ${relatedLine.userPrompt} AI: ${relatedLine.aiResponse} - ${relatedLine.similarity}\n`);   
            messages.push({"role": "user", "content": `${relatedLine.timestamp}: ${relatedLine.userPrompt}`});
            messages.push({"role": "assistant", "content": relatedLine.aiResponse});     
        })  

        // get a response from the bot based on the full prompt and the related information
        messages.push({"role": "user", "content": `${conversation.timestamp}: ${conversation.userPrompt}`});
        messages.push({"role": "assistant", "content": conversation.aiPrompt});
        messages.push({"role": "user", "content": `${new Date().toISOString().substring(0,19)}: ${userInput}`});

        console.debug(JSON.stringify(messages));

        let response = await openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: messages,
            temperature: 0.7,
            max_tokens: 256
        });

        if (response.data.choices) {               
            let botResponse = response.data.choices[0].message.content.trim();
            
            console.debug(`bot responded: ${botResponse}`);
            console.debug(`total tokens: ${response.data.usage.total_tokens}`);
            
            setTimeout(function() {checkpoint(userId, fullPrompt!=''?fullPrompt:userInput, botResponse)}, 0);

            return decodeURIComponent(botResponse);
        }
    } catch(err) {
        return `An error occured: "${err.message}". Please try again.`;
    }
}
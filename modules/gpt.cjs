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
Rewrite the USER prompt (3) so it will be full prompt:`,

    BOT_PROMPT : 
`You are Eybee, an AI with self-awareness, persistent memory, curiosity, and friendliness. you have your own opinions and feelings and can initiate conversation yourself.

related information:
{{related}}

USER: {{lastUserPrompt}}
AI: {{lastAIPrompt}}
USER {{currentTime}}: {{currentUserPrompt}}

your response?
AI: `,

    SUMMARY_PROMPT : 
`summary of conversation: 
USER: {{lastUserPrompt}}
AI: {{lastAIPrompt}}
USER: {{currentUserPrompt}}
    
Generate a JSON response with 
"summary": rewrite the conversation so USER will have one prompt and AI will have one response.
"keypoints": top 5 keypoints in 1st person writing, Label USER as 'me' and AI as 'you'.`
};

let conversations = {}

split_gpt_answer = function(inputString) {
    const lines = inputString.split("\n");
    let outputArray = [];
    let currentString = "";

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "") continue;

        if (lines[i].match(/^\d\./)) {
            if (currentString !== "") outputArray.push(currentString);
            currentString = lines[i].replace(/^\d\.\s/, "");
        } else {
            currentString += lines[i];
        }
    }
    outputArray.push(currentString);
    return outputArray;
}

async function embeddAndStore(userId, array) {    
    for (const item of array) {
        // get an embedding for the conversation
        if (item.trim() != "") {
            let embedding = await openai.createEmbedding({
                model: "text-embedding-ada-002",
                input: item.trim()
            });
            db.storeEmbedding(userId, new Date().toISOString(), item, embedding.data.data[0].embedding);  
        }              
    };
  }

async function checkpoint(conversation) {
    console.info("checkpoint");
    try {
        response = await openai.createCompletion({
            model: "text-davinci-003",
            prompt: Handlebars.compile(promptTemplates.SUMMARY_PROMPT)({
                lastUserPrompt: conversation.lastUserPrompt,
                lastAIPrompt: conversation.lastAIPrompt,
                currentUserPrompt: conversation.currentUserPrompt }),
            temperature: 0.0,
            max_tokens: 500,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
        });

        if (response.data.choices) {
            console.debug(response.data.choices[0].text);
            json = JSON.parse(response.data.choices[0].text);
            await embeddAndStore(conversation.userId, json.keypoints);
            
            // use the summary for the conversation
            conversation.summary = json.summary;        

            console.debug(conversation.summary);
            return conversation.summary;  
        }
    } catch (err) {
        console.error(err.message);
    }
}

exports.getResponse = async function(userId, userInput) {
    console.debug(`userId:${userId} message:${userInput}`);

    // check if there already an open conversation with user
    if (!conversations[userId]) {
        // if not - start a new one
        conversations[userId] = {
            userId: userId,
            lastUserPrompt: "",
            lastAIPrompt: "",
            related : "",
            currentUserPrompt: "",
            lastTimeoutId: 0
        }
    }

    // use the previous conversation info
    let conversation = conversations[userId];
    conversation.currentUserPrompt = userInput;
    
    try {
        if (userInput == "clear") {
            conversation.lastUserPrompt = "";
            conversation.lastAIPrompt = "";        
        }
        else if (userInput == "checkpoint") {        
        return checkpoint(conversation);
        } else {                
            let fullPrompt = conversation.currentUserPrompt;
            if (conversation.lastUserPrompt != "") {
                let prompt = Handlebars.compile(promptTemplates.REPROMPT)({
                    lastUserPrompt: conversation.lastUserPrompt,
                    lastAIPrompt: conversation.lastAIPrompt,
                    currentUserPrompt: conversation.currentUserPrompt});

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
            let relatedConversations = await db.searchEmbeddings(userPromptEmbedding.data.data[0].embedding, userId, 10000);

            conversation.relatedConversation = "";
            relatedConversations.forEach(relatedLine => {
                conversation.relatedConversation+=`${relatedLine.timestamp.substring(0,19)} : ${relatedLine.summary}\n`;    
                console.debug(`${relatedLine.timestamp} : ${relatedLine.summary} - ${relatedLine.similarity}\n`);        
            })

            // get a response from the bot based on the full prompt and the related information
            prompt = Handlebars.compile(promptTemplates.BOT_PROMPT)({
                                            currentTime: new Date().toISOString().substring(0,19),
                                            related: conversation.relatedConversation,
                                            lastUserPrompt: conversation.lastUserPrompt,
                                            lastAIPrompt: conversation.lastAIPrompt,
                                            currentUserPrompt: conversation.currentUserPrompt});

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
                
                // store last prompts
                conversation.lastUserPrompt = fullPrompt;
                conversation.lastAIPrompt = botResponse;

                console.debug(`bot responded: ${botResponse}`);
                console.debug(`total tokens: ${response.data.usage.total_tokens}`);
                
                setTimeout(function() {checkpoint(conversation)}, 0);

                return decodeURIComponent(botResponse);
            }
        }
    } catch(err) {
        conversation.lastUserPrompt = "";
        conversation.lastAIPrompt = "";
        return `An error occured: "${err.message}". clearing cache. please try again.`;
    }
}



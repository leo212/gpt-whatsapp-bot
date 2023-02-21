require('dotenv').config()
const readline = require('readline');
const gpt = require('./modules/gpt.cjs');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function promptUser() {
  let input = '';
  while (input.toLowerCase() !== 'bye') {
    input = await new Promise((resolve) => {
      rl.question('#: ', async function(userText) {
        let response = await gpt.getResponse('972537002122', userText);
        console.log(response);
        resolve(response);
      });
    });
  }
  rl.close();
}

promptUser();

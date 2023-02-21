const mongoose = require('mongoose');
const cosine = require('cosine-similarity');
const math = require('mathjs');


mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true });

// Define the schema for the embeddings collection
const embeddingSchema = new mongoose.Schema({
    userId: String,
    timestamp: String,
    summary: String,
    embedding: [Number]
  });
  
// Create the model for the embeddings collection
const Embedding = mongoose.model('Embedding', embeddingSchema);

exports.storeEmbedding = async function(userId, timestamp, summary, embedding) {
    const embeddingDoc = new Embedding({ userId, timestamp, summary, embedding });
    await embeddingDoc.save();
}

exports.deleteEmbedding = async function(id) {
  Embedding.findByIdAndRemove(id, function(err, doc) {
    if (err) {
      console.log(err);
    } else {
      console.log('Embedding with _id ' + doc._id + ' was deleted.');
    }
  });
}

exports.getLastConversation = async function(userId) {
  // query the last message of that user from the embeddings collection
  let lastMessage = await Embedding.find({userId: userId}).sort({timestamp:-1}).limit(1);

  if (lastMessage.length>0) {
    let text = lastMessage[0].summary;
    // get the USER text from the message and the AI text from the message
    const [userPrompt, aiPrompt] = text.split('\n').map(line => line.substring(line.indexOf(':') + 2));

    return {
      userPrompt: userPrompt,
      aiPrompt: aiPrompt,
      timestamp: lastMessage[0].timestamp, 
      embedding: lastMessage[0].embedding
    }
  } else {
    return {
      userPrompt: '',
      aiPrompt: '',
      timestamp: '',
      embedding: null
    }
  }
}

exports.searchEmbeddings = async function(inputEmbedding, userId, limit = 5, thresold = 0.7) {
  const results = await Embedding.aggregate([
    {
      $match: {
        userId: userId
      }
    },
    {
      $addFields: {
        similarity: {
          $let: {
            vars: {
              dotProduct: {
                $reduce: {
                  input: {
                    $zip: {
                      inputs: [inputEmbedding, "$embedding"]
                    }
                  },
                  initialValue: 0,
                  in: {
                    $sum: [
                      "$$value",
                      {
                        $multiply: [
                          {
                            $arrayElemAt: ["$$this", 0]
                          },
                          {
                            $arrayElemAt: ["$$this", 1]
                          }
                        ]
                      }
                    ]
                  }
                }
              },
              inputEmbeddingNorm: {
                $sqrt: {
                  $reduce: {
                    input: inputEmbedding,
                    initialValue: 0,
                    in: {
                      $sum: [
                        "$$value",
                        {
                          $pow: [
                            "$$this",
                            2
                          ]
                        }
                      ]
                    }
                  }
                }
              },
              embedNorm: {
                $sqrt: {
                  $reduce: {
                    input: "$embedding",
                    initialValue: 0,
                    in: {
                      $sum: [
                        "$$value",
                        {
                          $pow: [
                            "$$this",
                            2
                          ]
                        }
                      ]
                    }
                  }
                }
              }
            },
            in: {
              $divide: [
                "$$dotProduct",
                {
                  $multiply: [
                    "$$inputEmbeddingNorm",
                    "$$embedNorm"
                  ]
                }
              ]
            }
          }
        }
      }
    },
    { $match: { similarity: { $gt: thresold } } },
    { $sort: { similarity: -1 } },
    { $limit: limit }
  ])
  
  return results;  
}
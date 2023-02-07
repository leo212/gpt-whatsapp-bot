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

exports.searchEmbeddings = async function(inputEmbedding, userId, thresold) {
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
    { $sort: { similarity: -1 } },
    { $limit: 5 }
  ])
  
  return results;  
}
/*
exports.searchEmbeddings = async function(embedding, userId, threshold) {
  const results = await Embedding.aggregate([
    {
      $geoNear: {
        near: {
          type: "Point",
          coordinates: embedding
        },
        maxDistance: threshold,
        distanceField: "distance",
        query: { userId: userId },
        spherical: true
      }
    },
    { $limit: 5 }
  ]);
  return results;
  }*/
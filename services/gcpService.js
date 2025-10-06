const { VertexAI } = require('@google-cloud/vertexai');
const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs').promises;
const path = require('path');

// Initialize Vertex AI
const vertexAI = new VertexAI({
  project: 'company-chatbot-465813',
  location: 'us-central1',
  credentials: JSON.parse(process.env.GCP_CREDENTIALS)
});

// Initialize Text-to-Speech client
const ttsClient = new textToSpeech.TextToSpeechClient({
  credentials: JSON.parse(process.env.GCP_CREDENTIALS)
});

const model = 'gemini-1.5-flash';

class GCPService {
  
  // Extract skills, technologies, and insights from work entry
  async analyzeWorkEntry(title, description) {
    try {
      const generativeModel = vertexAI.getGenerativeModel({ model });
      
      const prompt = `Analyze this work entry and extract structured information:

Title: ${title}
Description: ${description}

Please provide a JSON response with:
1. extractedSkills: Array of objects with {name, category (Frontend/Backend/DevOps/Database/ML/Other), confidence (0-1)}
2. technologies: Array of technology names
3. problemsSolved: Number of problems/issues solved (estimate based on content)
4. accomplishments: Array of key accomplishments
5. productivity: Object with {hoursSpent (estimate), tasksCompleted (count), complexity (Easy/Medium/Hard)}

Example response:
{
  "extractedSkills": [
    {"name": "React", "category": "Frontend", "confidence": 0.95},
    {"name": "API Integration", "category": "Backend", "confidence": 0.88}
  ],
  "technologies": ["React", "Node.js", "MongoDB"],
  "problemsSolved": 3,
  "accomplishments": ["Built user authentication", "Optimized database queries"],
  "productivity": {"hoursSpent": 4, "tasksCompleted": 2, "complexity": "Medium"}
}

Return ONLY valid JSON, no markdown or explanations.`;

      const result = await generativeModel.generateContent(prompt);
      const response = result.response;
      const text = response.candidates[0].content.parts[0].text;
      
      // Clean up response (remove markdown if present)
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleanText);
      
    } catch (error) {
      console.error('Error analyzing work entry:', error);
      throw new Error(`AI Analysis failed: ${error.message}`);
    }
  }

  // Generate embeddings for RAG
  async generateEmbedding(text) {
    try {
      const generativeModel = vertexAI.getGenerativeModel({ 
        model: 'text-embedding-004'
      });
      
      const request = {
        contents: [{ role: 'user', parts: [{ text }] }]
      };
      
      const result = await generativeModel.generateContent(request);
      return result.response.candidates[0].content.parts[0].embedding || [];
      
    } catch (error) {
      console.error('Error generating embedding:', error);
      // Fallback: return empty array
      return [];
    }
  }

  // Search for similar bugs using RAG
  async searchSimilarBugs(query, bugEmbeddings) {
    try {
      const queryEmbedding = await this.generateEmbedding(query);
      
      // Calculate cosine similarity
      const similarities = bugEmbeddings.map(bug => {
        if (!bug.embedding || bug.embedding.length === 0) return { bug, similarity: 0 };
        
        const similarity = this.cosineSimilarity(queryEmbedding, bug.embedding);
        return { bug, similarity };
      });
      
      // Sort by similarity and return top 3
      return similarities
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3);
        
    } catch (error) {
      console.error('Error searching bugs:', error);
      return [];
    }
  }

  // Generate solution suggestion using RAG results
  async generateBugSolution(query, similarBugs) {
    try {
      const generativeModel = vertexAI.getGenerativeModel({ model });
      
      const context = similarBugs.map((item, idx) => 
        `Bug ${idx + 1} (Similarity: ${(item.similarity * 100).toFixed(1)}%):
Title: ${item.bug.title}
Description: ${item.bug.description}
Solution: ${item.bug.solution}
Tags: ${item.bug.tags.join(', ')}
---`
      ).join('\n\n');

      const prompt = `Based on these similar bugs I've solved before, help me with this new issue:

QUERY: ${query}

SIMILAR PAST SOLUTIONS:
${context}

Please provide:
1. A suggested solution based on the similar bugs
2. Key steps to resolve the issue
3. Any relevant warnings or best practices

Format your response clearly with sections.`;

      const result = await generativeModel.generateContent(prompt);
      const response = result.response;
      return response.candidates[0].content.parts[0].text;
      
    } catch (error) {
      console.error('Error generating solution:', error);
      throw new Error(`Solution generation failed: ${error.message}`);
    }
  }

  // Generate comprehensive report
  async generateReport(workEntries, startDate, endDate) {
    try {
      const generativeModel = vertexAI.getGenerativeModel({ model });
      
      // Aggregate data
      const allSkills = workEntries.flatMap(e => e.extractedSkills);
      const allTechs = [...new Set(workEntries.flatMap(e => e.technologies))];
      const totalProblems = workEntries.reduce((sum, e) => sum + (e.problemsSolved || 0), 0);
      const totalTasks = workEntries.reduce((sum, e) => sum + (e.productivity?.tasksCompleted || 0), 0);
      
      const dataContext = `
Period: ${startDate} to ${endDate}
Total Entries: ${workEntries.length}
Total Problems Solved: ${totalProblems}
Total Tasks Completed: ${totalTasks}
Technologies Used: ${allTechs.join(', ')}
Skills Developed: ${allSkills.map(s => s.name).join(', ')}
`;

      const prompt = `Generate a comprehensive productivity report based on this data:

${dataContext}

Please create a detailed report with these sections:
1. **Executive Summary**: Overview of the period
2. **Key Accomplishments**: Major achievements
3. **Skills Development**: Skills learned and improved (categorized)
4. **Technology Stack**: Technologies used and proficiency
5. **Problem Solving**: Analysis of problems solved
6. **Productivity Metrics**: Task completion, time management insights
7. **Areas for Growth**: Suggestions for improvement
8. **Recommendations**: Next steps and focus areas

Make it motivating and data-driven. Use specific numbers and be encouraging.`;

      const result = await generativeModel.generateContent(prompt);
      const response = result.response;
      return response.candidates[0].content.parts[0].text;
      
    } catch (error) {
      console.error('Error generating report:', error);
      throw new Error(`Report generation failed: ${error.message}`);
    }
  }

  // Convert text report to audio
  async generateAudio(text, outputPath = 'reports') {
    try {
      const request = {
        input: { text },
        voice: {
          languageCode: 'en-US',
          name: 'en-US-Neural2-J', // Male voice, change to 'en-US-Neural2-F' for female
          ssmlGender: 'MALE'
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 1.0,
          pitch: 0.0
        }
      };

      const [response] = await ttsClient.synthesizeSpeech(request);
      
      // Create output directory if it doesn't exist
      await fs.mkdir(outputPath, { recursive: true });
      
      const filename = `report_${Date.now()}.mp3`;
      const filepath = path.join(outputPath, filename);
      
      await fs.writeFile(filepath, response.audioContent, 'binary');
      
      return {
        filename,
        filepath,
        url: `/reports/${filename}` // Assuming you serve static files
      };
      
    } catch (error) {
      console.error('Error generating audio:', error);
      throw new Error(`Audio generation failed: ${error.message}`);
    }
  }

  // Helper: Calculate cosine similarity
  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

module.exports = new GCPService();
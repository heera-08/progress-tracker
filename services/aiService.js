const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@deepgram/sdk');
const fs = require('fs').promises;
const path = require('path');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Initialize Deepgram client
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

class AIService {
  
  // Extract skills, technologies, and insights from work entry
  async analyzeWorkEntry(title, description) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-001' });
      
      const prompt = `Analyze this work entry and extract structured information:

Title: ${title}
Description: ${description}

Please provide a JSON response with:
1. extractedSkills: Array of objects with {name, category (Frontend/AI/Git/Backend/Learning/problem solving/Bug fix/azure/AWS/Database/ML/Other), confidence (0-1)}
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

      const result = await model.generateContent(prompt);
      const response = result.response;
      const text = response.text();
      
      // Clean up response (remove markdown if present)
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleanText);
      
    } catch (error) {
      console.error('Error analyzing work entry:', error);
      throw new Error(`AI Analysis failed: ${error.message}`);
    }
  }

  // Generate embeddings for RAG using Gemini
  async generateEmbedding(text) {
    try {
      const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
      
      const result = await model.embedContent(text);
      return result.embedding.values;
      
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
      
      if (!queryEmbedding || queryEmbedding.length === 0) {
        return [];
      }
      
      // Calculate cosine similarity
      const similarities = bugEmbeddings.map(bug => {
        if (!bug.embedding || bug.embedding.length === 0) return { bug, similarity: 0 };
        
        const similarity = this.cosineSimilarity(queryEmbedding, bug.embedding);
        return { bug, similarity };
      });
      
      // Sort by similarity and return top 3
      return similarities
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3)
        .filter(item => item.similarity > 0.3); // Only return if similarity > 30%
        
    } catch (error) {
      console.error('Error searching bugs:', error);
      return [];
    }
  }

  // Generate solution suggestion using RAG results
  async generateBugSolution(query, similarBugs) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-001' });
      
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
1. A short and effective suggested solution based on the similar bugs
2. Key steps to resolve the issue

Format your response clearly with sections.`;

      const result = await model.generateContent(prompt);
      const response = result.response;
      return response.text();
      
    } catch (error) {
      console.error('Error generating solution:', error);
      throw new Error(`Solution generation failed: ${error.message}`);
    }
  }

  // Generate comprehensive report
  async generateReport(workEntries, startDate, endDate) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-001' });
      
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

Please create a quick summary report under 1500 characters, No preamble, let the tone be casual, do not be too generaic include keywords, use these sections:
1. **Executive Summary**: Overview of the period
2. **Key Accomplishments**: Major achievements
3. **Skills Development**: Skills learned and improved (categorized)
4. **Technology Stack**: Technologies used and proficiency
5. **Problem Solving**: Analysis of problems solved
6. **Productivity Metrics**: Task completion, time management insights
7. **Areas for Growth**: Suggestions for improvement
8. **Recommendations**: Next steps and focus areas

Make it motivating and data-driven. Use specific numbers and be encouraging.`;

      const result = await model.generateContent(prompt);
      const response = result.response;
      return response.text();
      
    } catch (error) {
      console.error('Error generating report:', error);
      throw new Error(`Report generation failed: ${error.message}`);
    }
  }

  // Convert text report to audio using Deepgram
  async generateAudio(text, outputPath = 'reports') {
    try {
      // Create output directory if it doesn't exist
      await fs.mkdir(outputPath, { recursive: true });
      
      const filename = `report_${Date.now()}.mp3`;
      const filepath = path.join(outputPath, filename);

      // Generate speech with Deepgram
      const response = await deepgram.speak.request(
        { text },
        {
          model: 'aura-asteria-en', // Natural female voice
          encoding: 'linear16',
          container: 'wav'
        }
      );

      // Get audio stream
      const stream = await response.getStream();
      
      if (!stream) {
        throw new Error('No audio stream returned from Deepgram');
      }

      // Convert stream to buffer
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      // Write to file
      await fs.writeFile(filepath, buffer);
      
      console.log(`✅ Audio file created: ${filepath}`);
      
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
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}

module.exports = new AIService();
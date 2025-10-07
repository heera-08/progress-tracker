const express = require('express');
const router = express.Router();
const Bug = require('../models/Bug');
const aiService = require('../services/aiService');

// Create new bug entry
router.post('/', async (req, res) => {
  try {
    const { title, description, solution, tags, severity, category } = req.body;

    if (!title || !description || !solution) {
      return res.status(400).json({ 
        error: 'Title, description, and solution are required' 
      });
    }

    // Generate embedding for RAG
    const embeddingText = `${title} ${description} ${solution}`;
    const embedding = await aiService.generateEmbedding(embeddingText);

    const bug = new Bug({
      title,
      description,
      solution,
      tags: tags || [],
      severity: severity || 'Medium',
      category: category || 'Other',
      embedding
    });

    await bug.save();

    res.status(201).json({
      message: 'Bug entry created successfully',
      data: bug
    });

  } catch (error) {
    console.error('Error creating bug entry:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all bugs
router.get('/', async (req, res) => {
  try {
    const { severity, category, tag, search } = req.query;
    
    let query = {};
    
    if (severity) query.severity = severity;
    if (category) query.category = category;
    if (tag) query.tags = tag;
    
    // Text search
    if (search) {
      query.$text = { $search: search };
    }
    
    const bugs = await Bug.find(query).sort({ resolvedDate: -1 });
    
    res.json({
      count: bugs.length,
      data: bugs
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single bug
router.get('/:id', async (req, res) => {
  try {
    const bug = await Bug.findById(req.params.id);
    
    if (!bug) {
      return res.status(404).json({ error: 'Bug not found' });
    }
    
    res.json(bug);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search for similar bugs and get AI solution (RAG)
router.post('/search-solution', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log('🔍 Searching for similar bugs using RAG...');

    // Get all bugs with embeddings
    const allBugs = await Bug.find({ embedding: { $exists: true, $ne: [] } });

    if (allBugs.length === 0) {
      return res.json({
        message: 'No bugs in database yet. Add some bug solutions first!',
        suggestedSolution: null,
        similarBugs: []
      });
    }

    // Find similar bugs using embeddings
    const similarBugs = await aiService.searchSimilarBugs(query, allBugs);

    if (similarBugs.length === 0) {
      return res.json({
        message: 'No similar bugs found',
        suggestedSolution: null,
        similarBugs: []
      });
    }

    // Generate AI solution based on similar bugs
    console.log('🤖 Generating AI solution based on similar bugs...');
    const aiSolution = await aiService.generateBugSolution(query, similarBugs);

    res.json({
      query,
      suggestedSolution: aiSolution,
      similarBugs: similarBugs.map(item => ({
        bug: {
          id: item.bug._id,
          title: item.bug.title,
          description: item.bug.description,
          solution: item.bug.solution,
          tags: item.bug.tags,
          severity: item.bug.severity
        },
        similarity: item.similarity
      }))
    });

  } catch (error) {
    console.error('Error searching for solution:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update bug
router.put('/:id', async (req, res) => {
  try {
    const { title, description, solution } = req.body;
    
    let updateData = { ...req.body };
    
    // Regenerate embedding if content changed
    if (title || description || solution) {
      const bug = await Bug.findById(req.params.id);
      const newTitle = title || bug.title;
      const newDesc = description || bug.description;
      const newSol = solution || bug.solution;
      
      const embeddingText = `${newTitle} ${newDesc} ${newSol}`;
      const embedding = await aiService.generateEmbedding(embeddingText);
      
      updateData.embedding = embedding;
    }
    
    const bug = await Bug.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!bug) {
      return res.status(404).json({ error: 'Bug not found' });
    }
    
    res.json({
      message: 'Bug updated successfully',
      data: bug
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete bug
router.delete('/:id', async (req, res) => {
  try {
    const bug = await Bug.findByIdAndDelete(req.params.id);
    
    if (!bug) {
      return res.status(404).json({ error: 'Bug not found' });
    }
    
    res.json({ message: 'Bug deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get bug statistics
router.get('/analytics/stats', async (req, res) => {
  try {
    const bugs = await Bug.find();
    
    const stats = {
      total: bugs.length,
      bySeverity: {
        Low: bugs.filter(b => b.severity === 'Low').length,
        Medium: bugs.filter(b => b.severity === 'Medium').length,
        High: bugs.filter(b => b.severity === 'High').length,
        Critical: bugs.filter(b => b.severity === 'Critical').length
      },
      byCategory: bugs.reduce((acc, bug) => {
        acc[bug.category] = (acc[bug.category] || 0) + 1;
        return acc;
      }, {}),
      commonTags: (() => {
        const tagMap = new Map();
        bugs.forEach(bug => {
          bug.tags.forEach(tag => {
            tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
          });
        });
        return Array.from(tagMap.entries())
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
      })()
    };
    
    res.json(stats);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
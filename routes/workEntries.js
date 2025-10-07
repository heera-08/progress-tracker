const express = require('express');
const router = express.Router();
const WorkEntry = require('../models/WorkEntry');
const aiService = require('../services/aiService');

// Create new work entry with AI analysis
router.post('/', async (req, res) => {
  try {
    const { title, description, date } = req.body;

    if (!title || !description) {
      return res.status(400).json({ 
        error: 'Title and description are required' 
      });
    }

    // Analyze entry with AI
    console.log('🤖 Analyzing work entry with AI...');
    const analysis = await aiService.analyzeWorkEntry(title, description);
    
    // Generate embedding for future RAG
    const embeddingText = `${title} ${description}`;
    const embedding = await aiService.generateEmbedding(embeddingText);

    // Create work entry
    const workEntry = new WorkEntry({
      title,
      description,
      date: date || new Date(),
      extractedSkills: analysis.extractedSkills || [],
      technologies: analysis.technologies || [],
      problemsSolved: analysis.problemsSolved || 0,
      accomplishments: analysis.accomplishments || [],
      productivity: analysis.productivity || {},
      embedding,
      aiProcessed: true
    });

    await workEntry.save();

    res.status(201).json({
      message: 'Work entry created and analyzed successfully',
      data: workEntry
    });

  } catch (error) {
    console.error('Error creating work entry:', error);
    
    // Save entry even if AI processing fails
    try {
      const workEntry = new WorkEntry({
        title: req.body.title,
        description: req.body.description,
        date: req.body.date || new Date(),
        aiProcessed: false,
        processingError: error.message
      });
      await workEntry.save();
      
      res.status(201).json({
        message: 'Work entry saved, but AI analysis failed',
        data: workEntry,
        warning: error.message
      });
    } catch (saveError) {
      res.status(500).json({ error: saveError.message });
    }
  }
});

// Get all work entries
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, technology, skill } = req.query;
    
    let query = {};
    
    // Filter by date range
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    
    // Filter by technology
    if (technology) {
      query.technologies = technology;
    }
    
    // Filter by skill
    if (skill) {
      query['extractedSkills.name'] = new RegExp(skill, 'i');
    }
    
    const entries = await WorkEntry.find(query).sort({ date: -1 });
    
    res.json({
      count: entries.length,
      data: entries
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single work entry
router.get('/:id', async (req, res) => {
  try {
    const entry = await WorkEntry.findById(req.params.id);
    
    if (!entry) {
      return res.status(404).json({ error: 'Work entry not found' });
    }
    
    res.json(entry);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update work entry
router.put('/:id', async (req, res) => {
  try {
    const { title, description } = req.body;
    
    // Re-analyze if title or description changed
    let updateData = { ...req.body };
    
    if (title || description) {
      const entry = await WorkEntry.findById(req.params.id);
      const newTitle = title || entry.title;
      const newDesc = description || entry.description;
      
      const analysis = await aiService.analyzeWorkEntry(newTitle, newDesc);
      const embedding = await aiService.generateEmbedding(`${newTitle} ${newDesc}`);
      
      updateData = {
        ...updateData,
        extractedSkills: analysis.extractedSkills,
        technologies: analysis.technologies,
        problemsSolved: analysis.problemsSolved,
        accomplishments: analysis.accomplishments,
        productivity: analysis.productivity,
        embedding,
        aiProcessed: true
      };
    }
    
    const entry = await WorkEntry.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!entry) {
      return res.status(404).json({ error: 'Work entry not found' });
    }
    
    res.json({
      message: 'Work entry updated successfully',
      data: entry
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete work entry
router.delete('/:id', async (req, res) => {
  try {
    const entry = await WorkEntry.findByIdAndDelete(req.params.id);
    
    if (!entry) {
      return res.status(404).json({ error: 'Work entry not found' });
    }
    
    res.json({ message: 'Work entry deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get skills summary
router.get('/analytics/skills', async (req, res) => {
  try {
    const entries = await WorkEntry.find({ aiProcessed: true });
    
    // Aggregate skills
    const skillsMap = new Map();
    
    entries.forEach(entry => {
      entry.extractedSkills.forEach(skill => {
        if (skillsMap.has(skill.name)) {
          const existing = skillsMap.get(skill.name);
          skillsMap.set(skill.name, {
            name: skill.name,
            category: skill.category,
            count: existing.count + 1,
            avgConfidence: (existing.avgConfidence * existing.count + skill.confidence) / (existing.count + 1)
          });
        } else {
          skillsMap.set(skill.name, {
            name: skill.name,
            category: skill.category,
            count: 1,
            avgConfidence: skill.confidence
          });
        }
      });
    });
    
    const skills = Array.from(skillsMap.values())
      .sort((a, b) => b.count - a.count);
    
    // Group by category
    const byCategory = skills.reduce((acc, skill) => {
      if (!acc[skill.category]) acc[skill.category] = [];
      acc[skill.category].push(skill);
      return acc;
    }, {});
    
    res.json({
      totalSkills: skills.length,
      skills,
      byCategory
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get technologies summary
router.get('/analytics/technologies', async (req, res) => {
  try {
    const entries = await WorkEntry.find({ aiProcessed: true });
    
    const techMap = new Map();
    
    entries.forEach(entry => {
      entry.technologies.forEach(tech => {
        techMap.set(tech, (techMap.get(tech) || 0) + 1);
      });
    });
    
    const technologies = Array.from(techMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    
    res.json({
      totalTechnologies: technologies.length,
      technologies
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
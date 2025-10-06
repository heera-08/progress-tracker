const express = require('express');
const router = express.Router();
const WorkEntry = require('../models/WorkEntry');
const gcpService = require('../services/gcpService');

// Generate comprehensive report
router.post('/generate', async (req, res) => {
  try {
    const { startDate, endDate, includeAudio } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ 
        error: 'Start date and end date are required' 
      });
    }

    console.log(`📊 Generating report from ${startDate} to ${endDate}...`);

    // Fetch work entries in date range
    const workEntries = await WorkEntry.find({
      date: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      },
      aiProcessed: true
    }).sort({ date: 1 });

    if (workEntries.length === 0) {
      return res.status(404).json({ 
        error: 'No work entries found in this date range' 
      });
    }

    // Generate AI report
    console.log('🤖 Generating AI-powered analysis...');
    const reportText = await gcpService.generateReport(
      workEntries, 
      startDate, 
      endDate
    );

    const response = {
      reportText,
      metadata: {
        period: { startDate, endDate },
        entriesCount: workEntries.length,
        generatedAt: new Date()
      }
    };

    // Generate audio if requested
    if (includeAudio) {
      console.log('🎙️ Converting report to audio...');
      const audioFile = await gcpService.generateAudio(reportText);
      response.audioFile = audioFile;
    }

    res.json(response);

  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get quick statistics
router.get('/stats', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        date: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };
    }

    const entries = await WorkEntry.find({ 
      ...dateFilter,
      aiProcessed: true 
    });

    // Calculate statistics
    const stats = {
      totalEntries: entries.length,
      totalProblemsSolved: entries.reduce((sum, e) => sum + (e.problemsSolved || 0), 0),
      totalTasksCompleted: entries.reduce((sum, e) => sum + (e.productivity?.tasksCompleted || 0), 0),
      totalHoursSpent: entries.reduce((sum, e) => sum + (e.productivity?.hoursSpent || 0), 0),
      
      skillsBreakdown: (() => {
        const skillMap = new Map();
        entries.forEach(entry => {
          entry.extractedSkills.forEach(skill => {
            const existing = skillMap.get(skill.name) || { count: 0, category: skill.category };
            skillMap.set(skill.name, { 
              count: existing.count + 1, 
              category: skill.category 
            });
          });
        });
        return Array.from(skillMap.entries())
          .map(([name, data]) => ({ name, ...data }))
          .sort((a, b) => b.count - a.count);
      })(),
      
      technologiesUsed: (() => {
        const techSet = new Set();
        entries.forEach(entry => {
          entry.technologies.forEach(tech => techSet.add(tech));
        });
        return Array.from(techSet);
      })(),
      
      complexityDistribution: (() => {
        const dist = { Easy: 0, Medium: 0, Hard: 0 };
        entries.forEach(entry => {
          const complexity = entry.productivity?.complexity;
          if (complexity && dist.hasOwnProperty(complexity)) {
            dist[complexity]++;
          }
        });
        return dist;
      })(),
      
      topAccomplishments: entries
        .flatMap(e => e.accomplishments)
        .slice(0, 10)
    };

    res.json(stats);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate audio from existing text
router.post('/generate-audio', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    console.log('🎙️ Generating audio file...');
    const audioFile = await gcpService.generateAudio(text);

    res.json({
      message: 'Audio generated successfully',
      audioFile
    });

  } catch (error) {
    console.error('Error generating audio:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get timeline view
router.get('/timeline', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        date: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };
    }

    const entries = await WorkEntry.find({
      ...dateFilter,
      aiProcessed: true
    }).sort({ date: 1 });

    // Group by week
    const timeline = entries.reduce((acc, entry) => {
      const weekStart = new Date(entry.date);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];

      if (!acc[weekKey]) {
        acc[weekKey] = {
          weekStart: weekKey,
          entries: [],
          totalProblems: 0,
          totalTasks: 0,
          skills: new Set(),
          technologies: new Set()
        };
      }

      acc[weekKey].entries.push(entry);
      acc[weekKey].totalProblems += entry.problemsSolved || 0;
      acc[weekKey].totalTasks += entry.productivity?.tasksCompleted || 0;
      entry.extractedSkills.forEach(s => acc[weekKey].skills.add(s.name));
      entry.technologies.forEach(t => acc[weekKey].technologies.add(t));

      return acc;
    }, {});

    // Convert sets to arrays
    const timelineArray = Object.values(timeline).map(week => ({
      ...week,
      skills: Array.from(week.skills),
      technologies: Array.from(week.technologies),
      entriesCount: week.entries.length
    }));

    res.json(timelineArray);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
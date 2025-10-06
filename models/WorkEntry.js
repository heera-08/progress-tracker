const mongoose = require('mongoose');

const workEntrySchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  // AI-extracted data
  extractedSkills: [{
    name: String,
    category: String, // Frontend, Backend, DevOps, Database, etc.
    confidence: Number
  }],
  technologies: [String],
  problemsSolved: {
    type: Number,
    default: 0
  },
  accomplishments: [String],
  productivity: {
    hoursSpent: Number,
    tasksCompleted: Number,
    complexity: String // Easy, Medium, Hard
  },
  // Metadata
  aiProcessed: {
    type: Boolean,
    default: false
  },
  processingError: String,
  embedding: [Number] // For RAG similarity search
}, {
  timestamps: true
});

// Index for efficient querying
workEntrySchema.index({ date: -1 });
workEntrySchema.index({ 'extractedSkills.name': 1 });
workEntrySchema.index({ technologies: 1 });

module.exports = mongoose.model('WorkEntry', workEntrySchema);
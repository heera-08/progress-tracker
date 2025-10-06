const mongoose = require('mongoose');

const bugSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  solution: {
    type: String,
    required: true
  },
  tags: [String], // e.g., ['React', 'API', 'Database']
  severity: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Critical'],
    default: 'Medium'
  },
  resolvedDate: {
    type: Date,
    default: Date.now
  },
  // For RAG search
  embedding: [Number], // Vector embedding for similarity search
  category: String, // Frontend, Backend, Database, etc.
}, {
  timestamps: true
});

// Index for text search
bugSchema.index({ title: 'text', description: 'text', solution: 'text' });
bugSchema.index({ tags: 1 });
bugSchema.index({ category: 1 });

module.exports = mongoose.model('Bug', bugSchema);
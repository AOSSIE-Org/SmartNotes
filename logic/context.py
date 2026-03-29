from sentence_transformers import SentenceTransformer
import numpy as np

# Load model (local embedding model)
model = SentenceTransformer('all-MiniLM-L6-v2')

# Store embeddings globally
note_embeddings = []

def embed(text):
    return model.encode(text)

def cosine_similarity(a, b):
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

def update_embeddings(notes):
    global note_embeddings
    note_embeddings = [embed(note) for note in notes]

def find_relevant(query, notes):
    if not notes:
        return []

    query_embedding = embed(query)

    scores = []
    for i, note_embedding in enumerate(note_embeddings):
        score = cosine_similarity(query_embedding, note_embedding)
        scores.append((score, notes[i]))

    scores.sort(reverse=True, key=lambda x: x[0])

    return [note for score, note in scores[:3]]
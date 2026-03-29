from logic.context import update_embeddings

notes = []

def add_note(text):
    notes.append(text)
    update_embeddings(notes)

def get_notes():
    return notes
from flask import Flask, render_template, request
from logic.notes import add_note, get_notes
from logic.qa import answer
from logic.linking import suggest
from logic.context import update_embeddings
from logic.summarizer import summarize_notes   

app = Flask(__name__)

@app.route("/", methods=["GET", "POST"])
def index():
    answer_text = ""
    links = []
    summary_text = ""   

    # Always get latest notes
    notes = get_notes()

    # Ensure embeddings are synced
    update_embeddings(notes)

    if request.method == "POST":

        # Add Note
        if "note" in request.form and request.form["note"].strip():
            note = request.form["note"].strip()

            add_note(note)

            # Refresh notes
            notes = get_notes()

            # Suggest related notes
            links = suggest(note, notes)

        #  Ask Question
        elif "question" in request.form and request.form["question"].strip():
            question = request.form["question"].strip()

            answer_text = answer(question, notes)

        #  Summarize Notes 
        elif "summarize" in request.form:
            summary_text = summarize_notes(notes)

    return render_template(
        "index.html",
        notes=notes,
        answer=answer_text,
        links=links,
        summary=summary_text   
    )

if __name__ == "__main__":
    app.run(debug=True)
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

# reuse same model
tokenizer = AutoTokenizer.from_pretrained("google/flan-t5-base")
model = AutoModelForSeq2SeqLM.from_pretrained("google/flan-t5-base")

def summarize_notes(notes):
    if not notes:
        return "No notes available."

    unique_notes = list(set(notes))
    context = " ".join(unique_notes)

    prompt = f"""
You are an expert at summarization.

Summarize the following notes into ONE short sentence capturing the main idea only.
Do not repeat phrases. Do not include unnecessary details.

Notes:
{context}

Final Answer (one sentence only):
"""

    inputs = tokenizer(prompt, return_tensors="pt", truncation=True)

    outputs = model.generate(
    **inputs,
    max_new_tokens=30,   # even shorter
    temperature=0.2,     # more focused
)
    summary = tokenizer.decode(outputs[0], skip_special_tokens=True)

    return summary
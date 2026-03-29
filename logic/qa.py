

from logic.context import find_relevant
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

tokenizer = AutoTokenizer.from_pretrained("google/flan-t5-base")
model = AutoModelForSeq2SeqLM.from_pretrained("google/flan-t5-base")


def answer(query, notes):
    relevant = find_relevant(query, notes)

    if not relevant:
        return "I couldn't find relevant information in your notes."

    context = " ".join(relevant)

    
    prompt = f"""
You must answer ONLY using the provided context.

Also explain briefly how the answer is derived from the context.

Context:
{context}

Question:
{query}

Answer:
"""

    inputs = tokenizer(prompt, return_tensors="pt", truncation=True)

    outputs = model.generate(
        **inputs,
        max_new_tokens=120,
        temperature=0.2
    )

    response = tokenizer.decode(outputs[0], skip_special_tokens=True)

    return response
from google import genai
import os

client = genai.Client(api_key=os.environ.get("GEMINI_API"))

response = client.models.generate_content(
    model="gemini-3-flash-preview",
    contents="Explain how AI works in a few words",
)

print(response.text)
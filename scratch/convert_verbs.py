import os
import re

dir_path = r"c:\Users\PC_User\OneDrive\Documents\João Gobira Growth\joaogobiragrowth\Curriculos"

# Multi-word replacements done in a single pass
def replace_responsavel(match):
    if match.group(1) == "R":
        return "Fui responsável por"
    else:
        return "fui responsável por"

# Single-word replacements mapped
word_replacements = {
    "Liderou": "Liderei",
    "liderou": "liderei",
    "Implementou": "Implementei",
    "implementou": "implementei",
    "Gerenciou": "Gerenciei",
    "gerenciou": "gerenciei",
    "Desenvolveu": "Desenvolvi",
    "desenvolveu": "desenvolvi",
    "Operacionalizou": "Operacionalizei",
    "operacionalizou": "operacionalizei",
    "Conduziu": "Conduzi",
    "conduziu": "conduzi",
    "Coordenou": "Coordenei",
    "coordenou": "coordenei",
    "Estruturou": "Estruturei",
    "estruturou": "estruturei",
    "Reduziu": "Reduzi",
    "reduziu": "reduzi",
    "Configurou": "Configurei",
    "configurou": "configurei",
    "Lançou": "Lancei",
    "lançou": "lancei",
    "Utilizou": "Utilizei",
    "utilizou": "utilizei",
    "Aumentou": "Aumentei",
    "aumentou": "aumentei",
    "Executou": "Executei",
    "executou": "executei",
    "Contribuiu": "Contribui",
    "contribuiu": "contribui",
    "Elaborou": "Elaborei",
    "elaborou": "elaborei",
    "Posicionou": "Posicionei",
    "posicionou": "posicionei",
    "Operou": "Operei",
    "operou": "operei",
    "Realizou": "Realizei",
    "realizou": "realizei",
    "Desenhou": "Desenhei",
    "desenhou": "desenhei",
    "Impulsionou": "Impulsionei",
    "impulsionou": "impulsionei",
    "Analisou": "Analisei",
    "analisou": "analisei",
    "Conectou": "Conectei",
    "conectou": "conectei",
}

# Compile a single regex for all the words
word_patterns = re.compile(r"\b(" + "|".join(re.escape(key) for key in word_replacements.keys()) + r")\b")

for filename in os.listdir(dir_path):
    if filename.endswith(".html"):
        file_path = os.path.join(dir_path, filename)
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        def replace_li(match):
            li_content = match.group(0)
            # 1. Single pass for "Responsável por"
            li_content = re.sub(r"\b(R|r)esponsável por\b", replace_responsavel, li_content)
            # 2. Single pass for all verbs
            li_content = word_patterns.sub(lambda m: word_replacements[m.group(1)], li_content)
            return li_content
            
        new_content = re.sub(r"<li>.*?</li>", replace_li, content, flags=re.DOTALL)
        
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(new_content)
        print(f"Updated {filename}")

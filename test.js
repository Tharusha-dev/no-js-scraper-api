import { promises as fs } from 'fs';
import path from 'path';

// Cache for categories and ingredients
let categoriesCache = null;
let ingredientsCache = {};

// Initialize cache
async function initializeCache() {
    if (categoriesCache) return; // Already initialized
    
    categoriesCache = await fs.readdir('ingredients');
    categoriesCache = categoriesCache.filter(file => 
        file !== 'categories.json' && 
        file !== '.DS_Store'
    );

    // Pre-load all ingredients
    for (const category of categoriesCache) {
        const ingredients = await fs.readdir(path.join('ingredients', category));
        ingredientsCache[category] = {};
        
        for (const ingredient of ingredients.filter(file => file !== '.DS_Store')) {
            const content = await fs.readFile(
                path.join('ingredients', category, ingredient), 
                'utf-8'
            );
            ingredientsCache[category][ingredient] = JSON.parse(content);
        }
    }
}

export async function scanForTechnologies(root, headers) {
    await initializeCache();
    const matchingIngredients = [];
    
    function addIngredient(category, ingredient) {
        const ingredientPath = `${category}/${ingredient}`;
        if (!matchingIngredients.includes(ingredientPath)) {
            matchingIngredients.push(ingredientPath);
        }
    }

    try {
        // Scan ingredients using cache
        for (const category of categoriesCache) {
            for (const [ingredient, ingredientData] of Object.entries(ingredientsCache[category])) {
                // Tag checks
                for (const tagCheck of ingredientData.checks.tags) {
                    const elements = root.querySelectorAll(tagCheck.tag);
                    // console.log(elements.length);
                    
                    elements.forEach(element => {
                        // Skip if element or tagCheck properties are null/undefined
                        if (!element || !tagCheck || !tagCheck.tag) return;

                        // Check for tag attribute (value is null)
                        if (tagCheck.attribute && 
                            tagCheck.value === null && 
                            element.getAttribute(tagCheck.attribute)) {
                            addIngredient(category, ingredient);
                        }
                        // Check for tag content with wildcards
                        else if (tagCheck.attribute && 
                                tagCheck.value && 
                                tagCheck.value.includes('*')) {
                            const checks = tagCheck.value.split('*');
                            const attributeValue = element.getAttribute(tagCheck.attribute);
                            if (attributeValue && checks.every(check => attributeValue.includes(check))) {
                                addIngredient(category, ingredient);
                            }
                        }
                        // Check for tag content (with attribute)
                        else if (tagCheck.attribute && 
                                tagCheck.value && 
                                element.getAttribute(tagCheck.attribute) && 
                                element.getAttribute(tagCheck.attribute).includes(tagCheck.value)) {
                            addIngredient(category, ingredient);
                        }
                        // Check for tag content (without attribute)
                        else if (tagCheck.attribute === null && 
                                tagCheck.value && 
                                element.text && 
                                element.text.includes(tagCheck.value)) {
                            addIngredient(category, ingredient);
                        }
                        // Check for meta generator
                        else if (tagCheck.tag === 'meta' && 
                                element.getAttribute('name') === 'generator' &&
                                element.getAttribute('content') && 
                                tagCheck.value && 
                                element.getAttribute('content').includes(tagCheck.value)) {
                            addIngredient(category, ingredient);
                        }
                        // Check for meta platform
                        else if (tagCheck.tag === 'meta' && 
                                element.getAttribute('name') === 'platform' &&
                                element.getAttribute('content') && 
                                tagCheck.value && 
                                element.getAttribute('content').includes(tagCheck.value)) {
                            addIngredient(category, ingredient);
                        }
                    });
                }

                // Header checks
                for (const headerCheck of ingredientData.checks.headers) {
                    const headerValue = headers[headerCheck.header.toLowerCase()];
                    if (headerValue) {
                        if (headerCheck.value === null) {
                            addIngredient(category, ingredient);
                        } else if (headerValue.includes(headerCheck.value)) {
                            addIngredient(category, ingredient);
                        }
                    }
                }
            }
        }

        // const ingredientNames = matchingIngredients.map(ingredient => 
        //     ingredient.split('/')[1].replace('.json', '')
        // );
        // console.log(matchingIngredients);

        const expanded = await processStuff(matchingIngredients)
        // console.log(expanded)

        return expanded;

    } catch (error) {
        throw error;
    }
}

async function processStuff(data) {
    // If we have the cache, use it (much faster)
    if (ingredientsCache) {
        return data.map(path => {
            const [category, filename] = path.split('/');
            return ingredientsCache[category][filename].name;
        });
    }
    
    // Fallback to file reading if cache somehow isn't available
    const ingredientPromises = data.map(async ingredientPath => {
        const content = await fs.readFile(
            `ingredients/${ingredientPath}`, 
            'utf8'
        );
        return JSON.parse(content).name;
    });
    
    return Promise.all(ingredientPromises);
}
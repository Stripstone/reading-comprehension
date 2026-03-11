
// Updated logic for better TOC parsing, improved page-end logic, and respect for user-configurable page size

// Enhanced function to handle weak TOC and dynamic section parsing
function rebuildTOC(epubContent) {
    let toc = [];
    let sectionRegex = /(Chapter \d+:.*|^.*)/g;  // Regex for capturing chapter-like headings

    let sections = epubContent.match(sectionRegex);
    if (sections) {
        sections.forEach((section, index) => {
            toc.push({ title: section, start: index });
        });
    }

    if (toc.length === 0) {
        toc.push({ title: "Untitled", start: 0 });
    }

    return toc;
}

// Adjusted pagination and break logic to prioritize clean start and end
function chunkBlocksToPages(blocks, pageSize = 1600) {
    let pages = [];
    let currentPage = '';
    let currentSize = 0;

    blocks.forEach(block => {
        let sentences = block.split(/(?<=[.?!])\s+/); // Split by sentence endings

        sentences.forEach(sentence => {
            let sentenceLength = sentence.length;

            // Check if adding this sentence would exceed the page size
            if (currentSize + sentenceLength > pageSize) {
                if (currentPage) {
                    pages.push(currentPage);  // Push current page if size exceeds
                    currentPage = sentence;  // Start new page with current sentence
                }
                currentSize = sentenceLength; // Reset size for the new page
            } else {
                currentPage += sentence + ' ';
                currentSize += sentenceLength;
            }
        });
    });

    // Push any remaining content to the last page
    if (currentPage) {
        pages.push(currentPage);
    }

    return pages;
}

// Improved function to clean the imported content by removing unnecessary spaces and tags
function cleanImportedBlock(rawText) {
    // Perform basic cleaning, e.g., remove excessive whitespace or HTML tags
    return rawText.replace(/\s+/g, ' ').replace(/<[^>]+>/g, '').trim();
}

// Dynamic chapter handling based on weak TOC or internal headings
function handleSections(epubContent, rangeStart = 0, rangeEnd = 1) {
    let toc = rebuildTOC(epubContent);
    let selectedSections = toc.slice(rangeStart, rangeEnd);

    let blocks = selectedSections.map(section => cleanImportedBlock(section.title));
    return chunkBlocksToPages(blocks);
}

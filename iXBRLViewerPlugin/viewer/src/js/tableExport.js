// Copyright 2019 Workiva Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import $ from 'jquery'
import FileSaver from 'file-saver'
import * as Excel from 'exceljs/dist/exceljs.min.js';
import { Fact } from './fact.js';

export class TableExport {
    constructor(table, report) {
        this._table = table;
        this._report = report;
    } 

    static addHandles(iframe, report) {
        $('table', iframe).each(function () {
            const table = $(this);
            if (table.find(".ixbrl-element").length > 0) {
                table.css("position", "relative");
                const exporter = new TableExport(table, report);
                $('<div class="ixbrl-table-handle"><span>Export table</span></div>')
                    .appendTo(table)
                    .click(() => exporter.exportTable());
            }
        });
    }

    _getRawTable() {
        const table = this._table;
        const report = this._report;
        let maxRowLength = 0;
        const rows = [];
        table.find("tr").each(function () {
            const row = [];
            $(this).find("td:visible, th:visible").each(function () {
                const colspan = $(this).attr("colspan");
                if (colspan) {
                    for (let i=0; i < colspan-1; i++) {
                        row.push({ type: "static", value: ""});
                    }
                }

                const facts = $(this).find(".ixbrl-element").addBack(".ixbrl-element");
                let fact = null;
                if (facts.length > 0) {
                    const id = facts.first().data('ivid');
                    fact = report.getItemById(id);
                }
                if (fact instanceof Fact) {
                    const cell = { type: "fact", fact: fact};
                    
                    const td = $(this)[0];
                    let n = facts[0];
                    let s = n.textContent;
                    while (n !== td) {
                        if (n.previousSibling !== null) {
                            n = n.previousSibling;
                        }
                        else {
                            n = n.parentNode;
                        }
                        if (n.nodeType == 3) {
                            s = n.textContent + s;
                        }
                    }
                    if (s.match(/[\(-]\s*\d/) !== null) {
                        cell.negative = true;
                    }
                    cell.topBorder = ($(this).css('border-top-style').match(/(solid|double)/) !== null);
                    cell.bottomBorder = ($(this).css('border-bottom-style').match(/(solid|double)/) !== null);
                    row.push(cell);
                    
                }
                else {
                    const v = $(this).text();
                    row.push({ type: "static", value: v});
                }
            });
            if (row.length > maxRowLength) {
                maxRowLength = row.length;
            }
            rows.push(row);
        });
        for (const row of rows) {
            while (row.length < maxRowLength) {
                row.push({ type: "static", value: "" });
            }
        }
        return rows;
    }

    _getFactsInSlice(slice) {
        return slice.filter((cell) => cell.type === 'fact').map((cell) => cell.fact);
    }

    /* 
     * Returns a Map of aspect names to Aspect objects for aspects that are common
     * to all facts in the given table slice.  Returns null if there are no facts
     * in the slice.
     */ 
    _getConstantAspectsForSlice(slice, aspects) {
        const facts = this._getFactsInSlice(slice);
        if (facts.length == 0) {
            return null;
        }
        const allAspectNamesSet = new Set();
        for (const fact of facts) {
            for (const a of fact.aspects()) {
                allAspectNamesSet.add(a.name());
            }
        }

        const constantAspects = new Map();
        for (const a of allAspectNamesSet) {
            constantAspects.set(a, facts[0].aspect(a));
            for (let j = 1; j < facts.length; j++) {
                if (constantAspects.get(a) === undefined || !constantAspects.get(a).equalTo(facts[j].aspect(a))) {
                    constantAspects.delete(a);
                }
            }
        }
        return constantAspects;
    }

    _writeTable(data) {
        const wb = new Excel.Workbook();
        const ws = wb.addWorksheet('Table');
        
        let s = '';
        for (const [i, row] of data.entries()) {
            for (const [j, cell] of row.entries()) {
                const cc = ws.getRow(i+1).getCell(j+1);

                if (cell.type === 'fact') {
                    cc.value = Number(cell.fact.value());
                    cc.numFmt = '#,##0';
                    ws.getColumn(j+1).width = 18;
                    /* Make this an option - apply presentation signs */
                    if (cell.negative) {
                        cc.value = Math.abs(cc.value) * -1;
                    }
                    else {
                        cc.value = Math.abs(cc.value);
                    }
                    cc.border = {};
                    if (cell.topBorder) {
                        cc.border.top = {style: "medium", color: { argb: 'FF000000' }};
                    }
                    if (cell.bottomBorder) {
                        cc.border.bottom = {style: "medium", color: { argb: 'FF000000' }};
                    }
                }
                else if (cell.type === 'aspectLabel') {
                    cc.value = cell.value;
                }
                else {
                    cc.value = cell.value;
                    cc.font = { color : { argb: 'FF707070' } };
                }
            }
        }
        return wb;
    }

    exportTable() {

        const data = this._getRawTable();
        let rowLength = 0;

        const rowAspects = []; // array of aspect sets that are constant for each row
        const allRowAspectNamesSet = new Set(); // set to record full set of aspect names that appear on rows
        for (const row of data) {
            const constantAspects = this._getConstantAspectsForSlice(row);
            rowAspects.push(constantAspects);
            if (constantAspects !== null) {
                for (const [aspectName, value] of constantAspects) {
                    allRowAspectNamesSet.add(aspectName)
                }
            }
            if (row.length > rowLength) {
                rowLength = row.length;
            }
        }

        const columnAspects = [];
        const allColumnAspectNameSet = new Set();
        for (let i = 0; i < rowLength; i++) {
            const slice = data.map(row => row[i]);
            const constantAspects = this._getConstantAspectsForSlice(slice);
            columnAspects.push(constantAspects);
            if (constantAspects !== null) {
                for (const [aspectName, value] of constantAspects) {
                    allColumnAspectNameSet.add(aspectName);
                }
            }
        }

        /* Attempt to remove unnecessary headers.  If an aspect is specified on all
         * columns that have facts (a universal column aspect), then don't include it
         * as a row aspect as well.  XXX: we should do the reverse, but need to be
         * careful not to delete aspects altogether. */
        const universalColumnAspectSet = new Set(allColumnAspectNameSet);
        for (const aspectName of allColumnAspectNameSet) {
            for (const [i, ca] of Object.entries(columnAspects)) {
                if (ca !== null && !ca.get(aspectName)) { 
                    universalColumnAspectSet.delete(aspectName) 
                }
            }
        }
        
        for (const aspectName of allColumnAspectNameSet) {
            allRowAspectNamesSet.delete(aspectName);
        }

        /* Insert new rows at the top of the table with labels for column
         * aspects */
        for (const aspectName of allColumnAspectNameSet) {
            /* Make space at the start of the new row for row aspects */
            const newRow = Array.from(allRowAspectNamesSet).map(() => "");
            for (let k = 0; k < rowLength; k++) {
                const ca = columnAspects[k] || new Map();
                let v = ca.get(aspectName);
                if (v !== undefined) {
                    v = v.valueLabel("std");
                }
                newRow.push({ type: 'aspectLabel', value : v || ""});
            }
            data.unshift(newRow);
        }

        /* Iterate over rows, skip the column header rows added above. */
        for (let k = allColumnAspectNameSet.size; k < data.length; k++) {
            const newCols = [];
            for (const aspectName of allRowAspectNamesSet) {
                const ra = rowAspects[k - allColumnAspectNameSet.size] || new Map();
                let v = ra.get(aspectName);
                if (v !== undefined) {
                    v = v.valueLabel("std");
                }
                newCols.push({ type: 'aspectLabel', value : v || ""});
            }
            /* Insert row labels at start of row */
            data[k] = newCols.concat(data[k]);
        }


        const wb = this._writeTable(data);
        wb.xlsx.writeBuffer().then( data => {
          const blob = new Blob( [data], {type: "application/octet-stream"} );
          FileSaver.saveAs( blob, 'table.xlsx');
        });
    }
}
